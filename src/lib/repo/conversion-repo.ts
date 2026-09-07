import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversionSource = 'hubla_webhook' | 'thank_you_page'

export async function getClickEventByTrackingId(
  db: SupabaseClient,
  trackingId: string
): Promise<{ id: string; testSlug: string; clientId: string } | null> {
  const { data, error } = await db
    .from('click_events')
    .select('id, tests(slug, client_id)')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const test = data.tests as unknown as { slug: string; client_id: string } | null
  return { id: data.id, testSlug: test?.slug ?? '', clientId: test?.client_id ?? '' }
}

export async function insertConversionIfNew(
  db: SupabaseClient,
  params: {
    clickEventId: string
    source: ConversionSource
    externalEventId?: string
    valueCents?: number | null
  }
): Promise<'inserted' | 'duplicate'> {
  const { error } = await db.from('conversions').insert({
    click_event_id: params.clickEventId,
    source: params.source,
    external_event_id: params.externalEventId ?? null,
    value_cents: params.valueCents ?? null,
  })

  if (error) {
    if (error.code === '23505') {
      // Two very different things land on 23505. Hitting the external_event_id index means the
      // platform redelivered a webhook it already sent -- dedup working as intended, and silence
      // is right. Hitting unique (click_event_id, source) means a SECOND real purchase on the
      // same click -- an order bump, a one-click upsell, a subscription renewal -- and that sale
      // is dropped from every report. It stays dropped until the constraint changes (see
      // docs/BANCO-DE-IDEIAS.md), but it should at least stop being invisible: with no trace at
      // all there is no way to tell afterwards whether it ever happened.
      const isRedelivery = (error.message ?? '').includes('external_event_id')
      if (!isRedelivery) {
        console.error('[conversion-duplicate-rejected]', {
          clickEventId: params.clickEventId,
          source: params.source,
          externalEventId: params.externalEventId ?? null,
        })
      }
      return 'duplicate'
    }
    throw error
  }
  return 'inserted'
}
