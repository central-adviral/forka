import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const saoPauloDay = (offset: number) => new Date(Date.now() - 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10)

describe('the Carteira reads the campaigns, the tax and the entry sales (0064)', () => {
  it('sums the spend with tax, today apart, entry sales, front revenue, open alerts and the owner', async () => {
    const email = `carteira-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await db.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Carteira', slug: `carteira-${Date.now()}` })
      .select()
      .single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()

    await admin.from('client_tax_rates').insert({ client_id: client!.id, valid_from: '2020-01-01', factor: 1.1 })
    await admin.from('campaign_daily').insert([
      { client_id: client!.id, data: saoPauloDay(0), campaign_id: 'c1', campaign_name: 'c1', spend: 100 },
      { client_id: client!.id, data: saoPauloDay(-3), campaign_id: 'c1', campaign_name: 'c1', spend: 200 },
    ])
    const sale = (externalId: string, isUpsell: boolean, valor: number) => ({
      sales_funnel_id: funnel!.id,
      external_id: externalId,
      data_venda: new Date(Date.now() - 86_400_000).toISOString(),
      status: 'aprovada',
      valor_bruto: valor,
      valor_liquido: valor,
      is_upsell: isUpsell,
      produto: externalId,
    })
    await admin.from('project_products').insert({ sales_funnel_id: funnel!.id, produto_nome: 'asc', papel: 'ascensao' })
    await admin.from('sales').insert([sale('e1', false, 10), sale('up', true, 5), sale('asc', false, 500)])
    const { data: watcher } = await admin
      .from('watchers')
      .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, metric: 'cpm', target: 10 })
      .select()
      .single()
    await admin.from('alerts').insert({ watcher_id: watcher!.id, client_id: client!.id, severity: 'crit', value: 20, day: saoPauloDay(-1) })

    const { data, error } = await db.rpc('get_portfolio_summary', { p_since: saoPauloDay(-6) })
    expect(error).toBeNull()
    const row = (data as Record<string, unknown>[]).find((r) => r.client_id === client!.id)!
    expect(Number(row.spend)).toBeCloseTo(330)
    expect(Number(row.spend_today)).toBeCloseTo(110)
    expect(Number(row.entry_sales)).toBe(1)
    expect(Number(row.net_revenue)).toBe(15)
    expect(Number(row.alerts_crit)).toBe(1)
    expect(Number(row.alerts_warn)).toBe(0)
    expect(row.responsaveis).toBe(email.split('@')[0])
  })
})
