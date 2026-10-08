import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { syncSalesForFunnel, type LaunchOpsSaleRow } from '@/lib/launchops/sync-sales'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

let funnelId: string
let clientId: string

beforeAll(async () => {
  const email = `refund-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  await owner.auth.signInWithPassword({ email, password: 'password123' })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Refund', slug: `refund-${unique()}` }).select().single()
  const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
  await admin.from('project_products').insert({ sales_funnel_id: funnel!.id, produto_nome: 'Curso', papel: 'entrada' })
  funnelId = funnel!.id
  clientId = client!.id
})

function row(overrides: Partial<LaunchOpsSaleRow> = {}): LaunchOpsSaleRow {
  return {
    id: crypto.randomUUID(),
    data_venda: '2026-09-01T15:00:00Z',
    produto_nome: 'Curso',
    status: 'aprovada',
    valor_bruto: 110,
    valor_liquido: 100,
    metodo_pagamento: 'pix',
    updated_at: '2026-09-01T15:00:00Z',
    transaction_id_plataforma: null,
    utm_source: 'facebookads',
    ...overrides,
  }
}

async function refundedAt(externalId: string) {
  const { data } = await admin.from('sales').select('status, reembolsado_em').eq('client_id', clientId).eq('external_id', externalId).single()
  return data as { status: string; reembolsado_em: string | null }
}

type Day = { data: string; vendas: number; receita_liquida: number; reembolsos: number; receita_reembolsada_liquida: number }
const byDay = (rows: Day[]) => new Map(rows.map((day) => [day.data, day]))

describe('0099: a refund is a date on the sale, not a deleted row', () => {
  it('keeps the sale on its day and takes the revenue off on the refund day', async () => {
    const refunded = row()
    const kept = row({ valor_bruto: 55, valor_liquido: 50 })
    await syncSalesForFunnel(admin, funnelId, [refunded, kept])

    const result = await syncSalesForFunnel(admin, funnelId, [{ ...refunded, status: 'reembolsada', updated_at: '2026-09-03T15:00:00Z' }])
    expect(result).toEqual({ synced: 0, refunded: 1, latestUpdatedAt: '2026-09-03T15:00:00Z' })
    expect(await refundedAt(refunded.id)).toEqual({ status: 'reembolsada', reembolsado_em: '2026-09-03T15:00:00+00:00' })

    // A resync of the same refund (a later updated_at) does not move it.
    await syncSalesForFunnel(admin, funnelId, [{ ...refunded, status: 'reembolsada', updated_at: '2026-09-05T15:00:00Z' }])
    expect((await refundedAt(refunded.id)).reembolsado_em).toBe('2026-09-03T15:00:00+00:00')

    const range = { p_since: '2026-09-01', p_until: '2026-09-06' }
    const { data: daily, error } = await owner.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, ...range })
    expect(error).toBeNull()
    const days = byDay(daily as Day[])
    expect(days.get('2026-09-01')).toMatchObject({ vendas: 2, receita_liquida: 150, reembolsos: 0 })
    expect(days.get('2026-09-03')).toMatchObject({ vendas: 0, receita_liquida: -100, reembolsos: 1, receita_reembolsada_liquida: 100 })

    const { data: clientDaily } = await owner.rpc('get_client_daily', { p_client_id: clientId, ...range })
    const clientDays = byDay(clientDaily as Day[])
    expect(clientDays.get('2026-09-01')).toMatchObject({ vendas: 2, receita_liquida: 150 })
    expect(clientDays.get('2026-09-03')).toMatchObject({ receita_liquida: -100, reembolsos: 1 })

    // The breakdowns leave the refunded sale out of a period it was refunded in...
    const period = { p_sales_funnel_id: funnelId, ...range }
    const origin = (await owner.rpc('get_funnel_sales_by_origin', period)).data as { vendas: number; receita_liquida: number }[]
    expect(origin.map((o) => [Number(o.vendas), Number(o.receita_liquida)])).toEqual([[1, 50]])
    const payment = (await owner.rpc('get_funnel_payment_breakdown', period)).data as { receita: number }[]
    expect(payment.map((p) => Number(p.receita))).toEqual([50])
    const products = (await owner.rpc('get_funnel_sales_by_product', period)).data as { sales_count: number }[]
    expect(products.map((p) => Number(p.sales_count))).toEqual([1])
    const hours = (await owner.rpc('get_funnel_sales_by_hour', period)).data as { sales_count: number }[]
    expect(hours.reduce((n, h) => n + Number(h.sales_count), 0)).toBe(1)
    const creatives = (await owner.rpc('get_funnel_report_by_creative', period)).data as { revenue: number }[]
    expect(creatives.reduce((n, c) => n + Number(c.revenue), 0)).toBe(0)

    // ...and keep it in a period that ended before the refund: it was a sale then.
    const before = (await owner.rpc('get_funnel_sales_by_origin', { p_sales_funnel_id: funnelId, p_since: '2026-09-01', p_until: '2026-09-02' }))
      .data as { vendas: number; receita_liquida: number }[]
    expect(before.map((o) => [Number(o.vendas), Number(o.receita_liquida)])).toEqual([[2, 150]])

    // Back to approved: the refund is undone.
    await syncSalesForFunnel(admin, funnelId, [{ ...refunded, updated_at: '2026-09-05T16:00:00Z' }])
    expect(await refundedAt(refunded.id)).toEqual({ status: 'aprovada', reembolsado_em: null })
    const after = byDay((await owner.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, ...range })).data as Day[])
    expect(after.get('2026-09-03')).toBeUndefined()
  })

  it('does not bring in a sale it never held as approved', async () => {
    const neverApproved = row({ status: 'recusada' })
    const result = await syncSalesForFunnel(admin, funnelId, [neverApproved])
    expect(result.refunded).toBe(0)
    const { data } = await admin.from('sales').select('id').eq('client_id', clientId).eq('external_id', neverApproved.id)
    expect(data).toEqual([])
  })
})
