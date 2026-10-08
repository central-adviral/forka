import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0091: every report cuts today at the last Meta pull, with net revenue', () => {
  it('leaves out of Origem, pagamento, horários, produto and Criativos the sales after the pull', async () => {
    const email = `today-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Today', slug: `today-${unique()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    await admin.from('project_products').insert({ sales_funnel_id: funnel!.id, produto_nome: 'Curso', papel: 'entrada' })

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const startOfToday = new Date(`${today}T00:00:00-03:00`).getTime()
    // Keep both sales inside today even right after midnight: the pull is at the middle of the day so far.
    const now = Date.now()
    const pull = new Date(startOfToday + (now - startOfToday) / 2)
    await admin.from('campaign_daily').insert({ client_id: client!.id, data: today, campaign_id: `c-${unique()}`, campaign_name: 'C', spend: 10, source_updated_at: pull.toISOString() })
    const sale = (id: string, at: Date) => ({
      sales_funnel_id: funnel!.id, external_id: `${id}-${unique()}`, data_venda: at.toISOString(), status: 'aprovada', produto: 'Curso',
      utm_source: 'facebookads', metodo_pagamento: 'pix', valor_bruto: 110, valor_liquido: 100,
    })
    const { error } = await admin.from('sales').insert([
      sale('before', new Date(pull.getTime() - (pull.getTime() - startOfToday) / 2)),
      sale('after', new Date(pull.getTime() + (now - pull.getTime()) / 2)),
    ])
    expect(error).toBeNull()
    const tomorrow = new Date(startOfToday + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const range = { p_sales_funnel_id: funnel!.id, p_since: today, p_until: tomorrow }

    const origin = (await owner.rpc('get_funnel_sales_by_origin', range)).data as { vendas: number; receita_liquida: number }[]
    expect(origin.reduce((n, row) => n + Number(row.vendas), 0)).toBe(1)
    expect(Number(origin[0].receita_liquida)).toBe(100)
    const payment = (await owner.rpc('get_funnel_payment_breakdown', range)).data as { receita: number }[]
    expect(Number(payment[0].receita)).toBe(100)
    const hours = (await owner.rpc('get_funnel_sales_by_hour', range)).data as { sales_count: number }[]
    expect(hours.reduce((n, row) => n + Number(row.sales_count), 0)).toBe(1)
    const products = (await owner.rpc('get_funnel_sales_by_product', range)).data as { sales_count: number }[]
    expect(Number(products[0].sales_count)).toBe(1)
  })
})
