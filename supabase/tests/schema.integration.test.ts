import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createTestUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
  })
  if (error) throw error
  return data.user!
}

async function signIn(email: string) {
  const client = createClient(URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return client
}

describe('schema RLS isolation', () => {
  it('owner can see their client, another user cannot', async () => {
    const ownerEmail = `owner-${Date.now()}@example.com`
    const otherEmail = `other-${Date.now()}@example.com`
    const owner = await createTestUser(ownerEmail)
    await createTestUser(otherEmail)

    const { data: client, error } = await admin
      .from('clients')
      .insert({ owner_id: owner.id, name: 'Cliente Teste', slug: `cliente-${Date.now()}` })
      .select()
      .single()
    if (error) throw error

    const ownerClient = await signIn(ownerEmail)
    const { data: ownVisible } = await ownerClient.from('clients').select('id').eq('id', client.id)
    expect(ownVisible).toHaveLength(1)

    const otherClient = await signIn(otherEmail)
    const { data: otherVisible } = await otherClient.from('clients').select('id').eq('id', client.id)
    expect(otherVisible).toHaveLength(0)
  })

  it('create_test_with_variants rejects weights that do not sum to 100', async () => {
    const email = `owner2-${Date.now()}@example.com`
    const user = await createTestUser(email)
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user.id, name: 'C2', slug: `c2-${Date.now()}` })
      .select()
      .single()

    const asOwner = await signIn(email)
    const { error } = await asOwner.rpc('create_test_with_variants', {
      p_client_id: client!.id,
      p_name: 'Teste X',
      p_slug: `teste-x-${Date.now()}`,
      p_fallback_url: null,
      p_test_type: 'page',
      p_sales_page_url: null,
      p_conversion_method: 'thank_you_page',
      p_variants: [
        { name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
        { name: 'B', weight_pct: 40, destination_url: 'https://example.com/b' },
      ],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('sum to 100')
  })

  it('create_test_with_variants marks the first variant in the array as control, regardless of name order', async () => {
    const email = `owner3-${Date.now()}@example.com`
    const user = await createTestUser(email)
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user.id, name: 'C3', slug: `c3-${Date.now()}` })
      .select()
      .single()

    const asOwner = await signIn(email)
    const { data: testId, error } = await asOwner.rpc('create_test_with_variants', {
      p_client_id: client!.id,
      p_name: 'Teste Y',
      p_slug: `teste-y-${Date.now()}`,
      p_fallback_url: null,
      p_test_type: 'page',
      p_sales_page_url: null,
      p_conversion_method: 'thank_you_page',
      p_variants: [
        { name: 'Zebra Original', weight_pct: 50, destination_url: 'https://example.com/z' },
        { name: 'Alpha Nova Oferta', weight_pct: 50, destination_url: 'https://example.com/a' },
      ],
    })
    if (error) throw error

    const { data: variants } = await admin.from('variants').select('name, is_control').eq('test_id', testId)
    const control = variants!.find((v) => v.is_control)
    expect(control?.name).toBe('Zebra Original')
    expect(variants!.filter((v) => v.is_control)).toHaveLength(1)
  })

  it('owner can read/write their client integrations columns, another user cannot', async () => {
    const ownerEmail = `domain-rls-owner-${Date.now()}@example.com`
    const otherEmail = `domain-rls-other-${Date.now()}@example.com`
    const owner = await createTestUser(ownerEmail)
    await createTestUser(otherEmail)

    const { data: client, error } = await admin
      .from('clients')
      .insert({ owner_id: owner.id, name: 'Domain RLS Test', slug: `domain-rls-${Date.now()}` })
      .select()
      .single()
    if (error) throw error

    const ownerClient = await signIn(ownerEmail)
    const { error: updateError } = await ownerClient
      .from('clients')
      .update({ custom_domain: 'ir.example.com', hubla_webhook_token: 'owner-token' })
      .eq('id', client.id)
    expect(updateError).toBeNull()

    const { data: ownVisible } = await ownerClient
      .from('clients')
      .select('custom_domain, hubla_webhook_token')
      .eq('id', client.id)
      .single()
    expect(ownVisible?.custom_domain).toBe('ir.example.com')
    expect(ownVisible?.hubla_webhook_token).toBe('owner-token')

    const otherClient = await signIn(otherEmail)
    const { data: otherUpdateResult } = await otherClient
      .from('clients')
      .update({ custom_domain: 'attacker.example.com' })
      .eq('id', client.id)
      .select()
    expect(otherUpdateResult).toHaveLength(0)

    const { data: stillOwnerDomain } = await admin.from('clients').select('custom_domain').eq('id', client.id).single()
    expect(stillOwnerDomain?.custom_domain).toBe('ir.example.com')
  })

  it('get_test_report_by_ad reports clicks, confirmed sales and revenue per ad, and denies other owners', async () => {
    const ownerEmail = `ad-report-owner-${Date.now()}@example.com`
    const otherEmail = `ad-report-other-${Date.now()}@example.com`
    const owner = await createTestUser(ownerEmail)
    await createTestUser(otherEmail)

    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: owner.id, name: 'Ad Report Client', slug: `ad-report-${Date.now()}` })
      .select()
      .single()

    const asOwner = await signIn(ownerEmail)
    const { data: testId, error: createError } = await asOwner.rpc('create_test_with_variants', {
      p_client_id: client!.id,
      p_name: 'Ad Report Test',
      p_slug: `ad-report-test-${Date.now()}`,
      p_fallback_url: null,
      p_test_type: 'page',
      p_sales_page_url: null,
      p_conversion_method: 'hubla_webhook',
      p_variants: [
        { name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
        { name: 'B', weight_pct: 50, destination_url: 'https://example.com/b' },
      ],
    })
    if (createError) throw createError

    const { data: variants } = await admin.from('variants').select('id, name').eq('test_id', testId)
    const variant = variants!.find((v) => v.name === 'A')
    const variantWithNoClicks = variants!.find((v) => v.name === 'B')

    const { data: convertedClick } = await admin
      .from('click_events')
      .insert({
        test_id: testId,
        variant_id: variant!.id,
        visitor_id: 'visitor-1',
        tracking_id: `trk-converted-${Date.now()}`,
        source_utms: { utm_term: 'anuncio-1' },
      })
      .select()
      .single()
    await admin.from('conversions').insert({
      click_event_id: convertedClick!.id,
      source: 'hubla_webhook',
      external_event_id: `inv-1-${Date.now()}`,
      value_cents: 1500,
    })

    // A click with no conversion must still appear (clicks are now tracked), but with zero sales/revenue.
    await admin.from('click_events').insert({
      test_id: testId,
      variant_id: variant!.id,
      visitor_id: 'visitor-2',
      tracking_id: `trk-no-sale-${Date.now()}`,
      source_utms: { utm_term: 'anuncio-2' },
    })

    // A converted click with no utm_term falls back to the '(sem anúncio)' label.
    const { data: noAdClick } = await admin
      .from('click_events')
      .insert({
        test_id: testId,
        variant_id: variant!.id,
        visitor_id: 'visitor-3',
        tracking_id: `trk-no-ad-${Date.now()}`,
        source_utms: {},
      })
      .select()
      .single()
    await admin.from('conversions').insert({
      click_event_id: noAdClick!.id,
      source: 'hubla_webhook',
      external_event_id: `inv-2-${Date.now()}`,
    })

    // A bot click on anuncio-1 must not count as a click, but must show up as a bot_clicks count.
    await admin.from('click_events').insert({
      test_id: testId,
      variant_id: variant!.id,
      visitor_id: 'visitor-bot',
      tracking_id: `trk-bot-${Date.now()}`,
      source_utms: { utm_term: 'anuncio-1' },
      is_bot: true,
    })

    const { data: rows, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
    if (error) throw error

    // 3 rows for variant A's ads, plus 1 zero row for variant B, which never received a click.
    expect(rows).toHaveLength(4)
    type AdRow = {
      variant_id: string
      ad_name: string
      clicks: number
      conversions: number
      revenue_cents: number
      bot_clicks: number
    }
    const variantARows = (rows as AdRow[]).filter((row) => row.variant_id === variant!.id)
    const byAdName = new Map(variantARows.map((row) => [row.ad_name, row]))

    expect(byAdName.get('anuncio-1')).toMatchObject({ clicks: 1, conversions: 1, revenue_cents: 1500, bot_clicks: 1 })
    expect(byAdName.get('anuncio-2')).toMatchObject({ clicks: 1, conversions: 0, revenue_cents: 0, bot_clicks: 0 })
    expect(byAdName.get('(sem anúncio)')).toMatchObject({ clicks: 1, conversions: 1, bot_clicks: 0 })

    const variantBRow = (rows as AdRow[]).find((row) => row.variant_id === variantWithNoClicks!.id)
    expect(variantBRow).toMatchObject({ clicks: 0, conversions: 0, revenue_cents: 0, bot_clicks: 0 })

    const otherClient = await signIn(otherEmail)
    const { error: deniedError } = await otherClient.rpc('get_test_report_by_ad', { p_test_id: testId })
    expect(deniedError).not.toBeNull()
    expect(deniedError!.message).toContain('access denied')
  })
})
