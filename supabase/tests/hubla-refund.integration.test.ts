import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { refundHublaConversion, wasRefunded } from '@/lib/repo/conversion-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0083: a Hubla refund leaves the test numbers', () => {
  it('moves the refunded sale out of the report, keeps the record, and is a no-op for another client or a second delivery', async () => {
    const email = `refund-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Refund', slug: `refund-${unique()}` }).select().single()
    const { data: test } = await admin.from('tests').insert({ client_id: client!.id, name: 'Reembolso', slug: `reembolso-${unique()}`, conversion_method: 'hubla_webhook' }).select().single()
    const { data: variants } = await admin
      .from('variants')
      .insert([
        { test_id: test!.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
        { test_id: test!.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
      ])
      .select()
    const a = variants!.find((row) => row.name === 'A')!.id
    const { data: click } = await admin
      .from('click_events')
      .insert({ test_id: test!.id, variant_id: a, visitor_id: crypto.randomUUID(), tracking_id: crypto.randomUUID(), source_utms: {}, created_at: '2026-10-01T10:00:00Z' })
      .select()
      .single()
    const invoice = `inv-${unique()}`
    await admin.from('conversions').insert({ click_event_id: click!.id, source: 'hubla_webhook', external_event_id: invoice, value_cents: 19700, created_at: '2026-10-01T10:10:00Z' })

    const report = async () => ((await owner.rpc('get_test_report', { p_test_id: test!.id, p_since: null, p_until: null })).data as { variant_id: string; conversions: number; revenue_cents: number }[]).find((row) => row.variant_id === a)!
    expect(await report()).toMatchObject({ conversions: 1, revenue_cents: 19700 })

    // Another client's webhook cannot refund this sale.
    expect(await refundHublaConversion(admin, { clientId: crypto.randomUUID(), externalEventId: invoice, refundedAt: '2026-10-02T09:00:00Z' })).toBe(false)
    expect(await report()).toMatchObject({ conversions: 1 })

    expect(await refundHublaConversion(admin, { clientId: client!.id, externalEventId: invoice, refundedAt: '2026-10-02T09:00:00Z' })).toBe(true)
    expect(await report()).toMatchObject({ conversions: 0, revenue_cents: 0 })
    expect(await wasRefunded(admin, invoice)).toBe(true)
    const { data: record } = await admin.from('conversion_refunds').select('value_cents, refunded_at').eq('external_event_id', invoice).single()
    expect(record).toEqual({ value_cents: 19700, refunded_at: '2026-10-02T09:00:00+00:00' })

    // Hubla re-delivers: the second refund finds nothing to move.
    expect(await refundHublaConversion(admin, { clientId: client!.id, externalEventId: invoice, refundedAt: '2026-10-02T09:00:00Z' })).toBe(false)

    // The app's own session cannot call it: only the webhook (service role) does.
    const { error } = await owner.rpc('refund_hubla_conversion', { p_client_id: client!.id, p_external_event_id: invoice, p_refunded_at: '2026-10-02T09:00:00Z' })
    expect(error).not.toBeNull()
  })
})
