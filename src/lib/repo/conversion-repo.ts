import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversionSource = 'hubla_webhook' | 'thank_you_page'

export async function getClickEventByTrackingId(
  db: SupabaseClient,
  trackingId: string
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('click_events')
    .select('id')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (error) throw error
  return data
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
    if (error.code === '23505') return 'duplicate'
    throw error
  }
  return 'inserted'
}
