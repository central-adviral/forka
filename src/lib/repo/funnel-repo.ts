import type { SupabaseClient } from '@supabase/supabase-js'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'

// `since`/`until` are plain date strings (e.g. "2026-08-04"); querying data_venda against them
// directly would compare with UTC midnight, not BRT midnight -- dayKey() below buckets by BRT
// day, so the bound has to line up or a sale near midnight BRT falls outside a range its own day
// is inside. This file had the app's only correct handling of that; the definition now lives in
// report-period so every period in the app resolves against the same boundary.

export interface DailyFunnelRow {
  data: string
  vendas: number
  receitaBruta: number
  receitaLiquida: number
  spend: number
  impressions: number
  clicks: number
  reach: number
  linkClicks: number
  landingPageViews: number
  initiateCheckout: number
  roas: number | null
  cac: number | null
}

export async function getDailyFunnel(
  db: SupabaseClient,
  salesFunnelId: string,
  since: string,
  until: string
): Promise<DailyFunnelRow[]> {
  const { data: salesRows, error: salesError } = await db
    .from('sales')
    .select('data_venda, valor_bruto, valor_liquido')
    .eq('sales_funnel_id', salesFunnelId)
    .gte('data_venda', brtDayBoundaryUtc(since))
    .lt('data_venda', brtDayBoundaryUtc(until))
  if (salesError) throw salesError

  const { data: spendRows, error: spendError } = await db
    .from('ad_spend_daily')
    .select('data, spend, impressions, clicks, reach, link_clicks, landing_page_views, initiate_checkout')
    .eq('sales_funnel_id', salesFunnelId)
    .gte('data', since)
    .lt('data', until)
  if (spendError) throw spendError

  const byDay = new Map<
    string,
    {
      vendas: number
      receitaBruta: number
      receitaLiquida: number
      spend: number
      impressions: number
      clicks: number
      reach: number
      linkClicks: number
      landingPageViews: number
      initiateCheckout: number
    }
  >()
  // Sales timestamps are UTC; ad_spend_daily.data already arrives in the ad account's
  // local timezone (America/Sao_Paulo), so bucket sales by the same BRT calendar day.
  const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))
  const emptyEntry = () => ({
    vendas: 0,
    receitaBruta: 0,
    receitaLiquida: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    linkClicks: 0,
    landingPageViews: 0,
    initiateCheckout: 0,
  })

  for (const row of (salesRows ?? []) as { data_venda: string; valor_bruto: number | null; valor_liquido: number | null }[]) {
    const key = dayKey(row.data_venda)
    const entry = byDay.get(key) ?? emptyEntry()
    entry.vendas += 1
    entry.receitaBruta += row.valor_bruto ?? 0
    entry.receitaLiquida += row.valor_liquido ?? 0
    byDay.set(key, entry)
  }

  for (const row of (spendRows ?? []) as {
    data: string
    spend: number
    impressions: number
    clicks: number
    reach: number
    link_clicks: number
    landing_page_views: number
    initiate_checkout: number
  }[]) {
    const entry = byDay.get(row.data) ?? emptyEntry()
    entry.spend += row.spend
    entry.impressions += row.impressions
    entry.clicks += row.clicks
    entry.reach += row.reach
    entry.linkClicks += row.link_clicks
    entry.landingPageViews += row.landing_page_views
    entry.initiateCheckout += row.initiate_checkout
    byDay.set(row.data, entry)
  }

  return [...byDay.entries()]
    .map(([data, entry]) => ({
      data,
      ...entry,
      roas: entry.spend > 0 ? entry.receitaBruta / entry.spend : null,
      cac: entry.vendas > 0 ? entry.spend / entry.vendas : null,
    }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

export interface PaymentMethodBreakdown {
  metodo: string
  receita: number
}

export async function getPaymentMethodBreakdown(
  db: SupabaseClient,
  salesFunnelId: string,
  since: string,
  until: string
): Promise<PaymentMethodBreakdown[]> {
  const { data, error } = await db
    .from('sales')
    .select('metodo_pagamento, valor_bruto')
    .eq('sales_funnel_id', salesFunnelId)
    .gte('data_venda', brtDayBoundaryUtc(since))
    .lt('data_venda', brtDayBoundaryUtc(until))
  if (error) throw error

  const byMethod = new Map<string, number>()
  for (const row of (data ?? []) as { metodo_pagamento: string | null; valor_bruto: number | null }[]) {
    const key = row.metodo_pagamento ?? 'desconhecido'
    byMethod.set(key, (byMethod.get(key) ?? 0) + (row.valor_bruto ?? 0))
  }

  return [...byMethod.entries()]
    .map(([metodo, receita]) => ({ metodo, receita }))
    .sort((a, b) => b.receita - a.receita)
}

export interface SyncHealth {
  entity: string
  lastRunAt: string | null
  lastResult: string | null
  lastMessage: string | null
}

export async function getFunnelSyncHealth(db: SupabaseClient, salesFunnelId: string): Promise<SyncHealth[]> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('entity, last_run_at, last_result, last_message')
    .eq('sales_funnel_id', salesFunnelId)
  if (error) throw error
  return ((data ?? []) as { entity: string; last_run_at: string | null; last_result: string | null; last_message: string | null }[]).map(
    (row) => ({ entity: row.entity, lastRunAt: row.last_run_at, lastResult: row.last_result, lastMessage: row.last_message })
  )
}
