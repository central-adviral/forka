import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0088: every sale the test can see, and how many it saw', () => {
  it('recovers the sales the webhook missed once, keeps refunded ones out, and reports the coverage', async () => {
    const email = `reliability-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Reliability', slug: `reliability-${unique()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const { data: test } = await admin
      .from('tests')
      .insert({ client_id: client!.id, name: 'Página', slug: `pagina-${unique()}`, conversion_method: 'hubla_webhook', sales_funnel_id: funnel!.id })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
      .select()
      .single()
    const click = async (visitor: string) =>
      (await admin
        .from('click_events')
        .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: visitor, tracking_id: crypto.randomUUID(), source_utms: {}, created_at: '2026-10-01T10:00:00Z' })
        .select('id, tracking_id')
        .single()).data!
    const [byWebhook, missed, refundedEarly] = [await click('v1'), await click('v2'), await click('v3')]
    const invoice = (label: string) => `inv-${label}-${unique()}`
    const [inv1, inv2, inv3] = [invoice('webhook'), invoice('missed'), invoice('refunded')]

    // The webhook counted the first sale; it never saw the second; the third was refunded first.
    await admin.from('conversions').insert({ click_event_id: byWebhook.id, source: 'hubla_webhook', external_event_id: inv1, value_cents: 19700, created_at: '2026-10-01T10:31:00Z' })
    await admin.from('hubla_events').insert({ client_id: client!.id, invoice_id: inv3, kind: 'refund', outcome: 'refund_unmatched' })
    const sale = (id: string, inv: string, trackingId: string) => ({
      sales_funnel_id: funnel!.id,
      external_id: `${id}-${unique()}`,
      data_venda: '2026-10-01T10:30:00Z',
      status: 'aprovada',
      transaction_id_plataforma: inv,
      utm_content: trackingId,
      is_upsell: false,
      valor_bruto: 197,
      valor_liquido: 180,
    })
    const { error: salesError } = await admin
      .from('sales')
      .insert([sale('s1', inv1, byWebhook.tracking_id), sale('s2', inv2, missed.tracking_id), sale('s3', inv3, refundedEarly.tracking_id)])
    expect(salesError).toBeNull()

    expect((await admin.rpc('recover_conversions_from_sales', { p_client_id: client!.id })).data).toBe(1)
    // A second run finds nothing new: the invoice is the key.
    expect((await admin.rpc('recover_conversions_from_sales', { p_client_id: client!.id })).data).toBe(0)

    const { data: recovered } = await admin.from('conversions').select('click_event_id, value_cents, created_at, recovered_via').eq('external_event_id', inv2).single()
    expect(recovered).toMatchObject({ click_event_id: missed.id, value_cents: 19700, recovered_via: 'launchops_sync' })
    expect(new Date(recovered!.created_at).toISOString()).toBe('2026-10-01T10:30:00.000Z')
    expect((await admin.from('conversions').select('id').eq('external_event_id', inv3)).data).toEqual([])
    // Nobody but the service role recovers.
    expect((await owner.rpc('recover_conversions_from_sales', { p_client_id: client!.id })).error).not.toBeNull()

    const { data: health, error } = await owner.rpc('get_test_data_health', { p_test_id: test!.id })
    expect(error).toBeNull()
    expect(health[0]).toMatchObject({ traceable_sales: 3, counted_sales: 2, recovered: 1, clicks: 3, buyers: 2 })
    expect(Number(health[0].median_delay_seconds)).toBe(60)
  })
})
