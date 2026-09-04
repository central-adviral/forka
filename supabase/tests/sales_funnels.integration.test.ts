// supabase/tests/sales_funnels.integration.test.ts
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `sales-funnels-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

describe('sales_funnels', () => {
  it('lets the owner read and write their own funnel, and blocks a different owner from seeing it', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Sales Funnels RLS Test', slug: `sf-rls-${Date.now()}` })
      .select()
      .single()

    const { data: funnel, error: insertError } = await asOwner
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: '1K LATAM', slug: '1k-latam' })
      .select()
      .single()
    expect(insertError).toBeNull()

    const { asOwner: asOther } = await createSignedInOwner()
    const { data: seenByOther } = await asOther.from('sales_funnels').select('id').eq('id', funnel!.id)
    expect(seenByOther).toEqual([])
  })

  it('rejects two funnels with the same slug for the same client', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Sales Funnels Slug Test', slug: `sf-slug-${Date.now()}` })
      .select()
      .single()

    await asOwner.from('sales_funnels').insert({ client_id: client!.id, name: 'Funil A', slug: 'meu-funil' })
    const { error } = await asOwner.from('sales_funnels').insert({ client_id: client!.id, name: 'Funil B', slug: 'meu-funil' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
  })

  it('sums ad_creative_spend_daily across every sales_funnel of the client when reporting by ad', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Multi Funnel Ad Spend Test', slug: `multi-funnel-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Multi Funil',
        slug: `teste-multi-funil-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnelA } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil A', slug: 'funil-a' })
      .select()
      .single()
    const { data: funnelB } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil B', slug: 'funil-b' })
      .select()
      .single()

    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: funnelA!.id, data: '2026-09-01', ad_id: 'ad-1', ad_name: 'Anúncio X', spend: 100, impressions: 1000, link_clicks: 50 },
      { sales_funnel_id: funnelB!.id, data: '2026-09-01', ad_id: 'ad-1', ad_name: 'Anúncio X', spend: 50, impressions: 500, link_clicks: 25 },
    ])

    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v1',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-1' },
    })

    const { data: byAd, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(error).toBeNull()
    const row = byAd!.find((r: { ad_name: string }) => r.ad_name === 'ad-1')
    expect(row).toMatchObject({ ad_spend: 150, ad_impressions: 1500, ad_link_clicks: 75 })
  })

  it('never mixes up bot clicks with ad spend across multiple funnels', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Multi Funnel Bot Test', slug: `multi-funnel-bot-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Multi Funil Bot',
        slug: `teste-multi-funil-bot-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnel } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil A', slug: 'funil-a' })
      .select()
      .single()

    await admin.from('ad_creative_spend_daily').insert({
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: 'ad-bot',
      ad_name: 'Anúncio Bot',
      spend: 30,
      impressions: 300,
      link_clicks: 15,
    })
    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v-bot',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-bot' },
      is_bot: true,
    })

    const { data: byAd, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(error).toBeNull()
    const row = byAd!.find((r: { ad_name: string }) => r.ad_name === 'ad-bot')
    expect(row).toMatchObject({ clicks: 0, bot_clicks: 1, ad_spend: 30 })
  })

  it('keeps a test report intact after one of the client sales_funnels is deleted', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Delete Funnel Test', slug: `delete-funnel-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Delete Funil',
        slug: `teste-delete-funil-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnelToKeep } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Fica', slug: 'fica' })
      .select()
      .single()
    const { data: funnelToDelete } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Sai', slug: 'sai' })
      .select()
      .single()
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: funnelToKeep!.id, data: '2026-09-01', ad_id: 'ad-keep', ad_name: 'Anúncio Fica', spend: 20, impressions: 200, link_clicks: 10 },
      { sales_funnel_id: funnelToDelete!.id, data: '2026-09-01', ad_id: 'ad-keep', ad_name: 'Anúncio Fica', spend: 15, impressions: 150, link_clicks: 5 },
    ])
    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v-delete-funnel',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-keep' },
    })

    const beforeDelete = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(beforeDelete.error).toBeNull()
    expect(beforeDelete.data!.find((r: { ad_name: string }) => r.ad_name === 'ad-keep')).toMatchObject({ ad_spend: 35, clicks: 1 })

    await admin.from('sales_funnels').delete().eq('id', funnelToDelete!.id)

    const afterDelete = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(afterDelete.error).toBeNull()
    expect(afterDelete.data!.find((r: { ad_name: string }) => r.ad_name === 'ad-keep')).toMatchObject({ ad_spend: 20, clicks: 1 })
  })
})
