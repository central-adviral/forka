import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversionSource = 'hubla_webhook' | 'thank_you_page'

export async function getClickEventByTrackingId(
  db: SupabaseClient,
  trackingId: string
): Promise<{ id: string; testSlug: string; clientId: string; isBot: boolean } | null> {
  const { data, error } = await db
    .from('click_events')
    .select('id, is_bot, tests(slug, client_id)')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const test = data.tests as unknown as { slug: string; client_id: string } | null
  return { id: data.id, testSlug: test?.slug ?? '', clientId: test?.client_id ?? '', isBot: Boolean(data.is_bot) }
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
      // Since migration 0050 a click carries as many sales as the buyer actually makes, so 23505
      // no longer hides a dropped purchase. It now means one of two harmless things: the platform
      // redelivered an invoice it had already sent, or the thank-you page was loaded twice. Both
      // answer the same question -- already counted -- and both are correctly silent.
      return 'duplicate'
    }
    throw error
  }
  return 'inserted'
}
