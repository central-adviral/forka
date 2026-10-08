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

/**
 * Whether this invoice was refunded: a re-delivered payment must not bring it back (0083), and a
 * refund that arrived before its payment keeps that payment out (0088).
 */
export async function wasRefunded(db: SupabaseClient, externalEventId: string): Promise<boolean> {
  const [moved, early] = await Promise.all([
    db.from('conversion_refunds').select('conversion_id', { count: 'exact', head: true }).eq('external_event_id', externalEventId),
    db.from('hubla_events').select('id', { count: 'exact', head: true }).eq('invoice_id', externalEventId).eq('kind', 'refund'),
  ])
  if (moved.error) throw moved.error
  if (early.error) throw early.error
  return (moved.count ?? 0) + (early.count ?? 0) > 0
}

export type HublaEventOutcome = 'counted' | 'duplicate' | 'no_tracking' | 'unknown_click' | 'already_refunded' | 'refunded' | 'refund_unmatched'

/** Keeps what happened to each Hubla payment or refund (0088), with no customer data, so the loss can be measured. */
export async function recordHublaEvent(
  db: SupabaseClient,
  event: { clientId: string; invoiceId: string | null; kind: 'payment' | 'refund'; outcome: HublaEventOutcome; clickEventId?: string | null; valueCents?: number | null }
): Promise<void> {
  const { error } = await db.from('hubla_events').insert({
    client_id: event.clientId,
    invoice_id: event.invoiceId,
    kind: event.kind,
    outcome: event.outcome,
    click_event_id: event.clickEventId ?? null,
    value_cents: event.valueCents ?? null,
  })
  // The record is for measuring; losing one must never fail the sale it describes.
  if (error) console.error('[hubla-event-record-failed]', { invoiceId: event.invoiceId, outcome: event.outcome }, error)
}

/** Turns synced sales carrying a click's id into the conversions the webhook missed (0088). */
export async function recoverConversionsFromSales(db: SupabaseClient, clientId: string): Promise<number> {
  const { data, error } = await db.rpc('recover_conversions_from_sales', { p_client_id: clientId })
  if (error) throw error
  return Number(data ?? 0)
}

/** Moves a refunded Hubla sale out of the test's numbers (0083). False when nothing matched. */
export async function refundHublaConversion(db: SupabaseClient, params: { clientId: string; externalEventId: string; refundedAt: string }): Promise<boolean> {
  const { data, error } = await db.rpc('refund_hubla_conversion', { p_client_id: params.clientId, p_external_event_id: params.externalEventId, p_refunded_at: params.refundedAt })
  if (error) throw error
  return data === true
}

