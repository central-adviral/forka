import type { SupabaseClient } from '@supabase/supabase-js'

// `since`/`until` are plain date strings (e.g. "2026-08-04") read as São Paulo calendar days: the
// SQL functions bound data_venda by BRT midnight and bucket each sale by its BRT day, so a sale
// near midnight lands on the same day the report shows it under.

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
  /** Where the spend came from: the project's campaign fronts, or the LaunchOps operation mapping. */
  spendSource: 'frentes' | 'operacao'
}

export async function getDailyFunnel(
  db: SupabaseClient,
  salesFunnelId: string,
  since: string,
  until: string
): Promise<DailyFunnelRow[]> {
  // Summed in the database (get_funnel_daily, 0053): reading the sales rows here capped at the
  // API's 1000-row limit and undercounted every busy period without saying so.
  const { data, error } = await db.rpc('get_funnel_daily', { p_sales_funnel_id: salesFunnelId, p_since: since, p_until: until })
  if (error) throw error
  return ((data ?? []) as {
    data: string
    vendas: number
    receita_bruta: number
    receita_liquida: number
    spend: number
    impressions: number
    clicks: number
    reach: number
    link_clicks: number
    landing_page_views: number
    initiate_checkout: number
    spend_source: 'frentes' | 'operacao'
  }[]).map((row) => {
    const vendas = Number(row.vendas)
    const spend = Number(row.spend)
    const receitaBruta = Number(row.receita_bruta)
    return {
      data: row.data,
      vendas,
      receitaBruta,
      receitaLiquida: Number(row.receita_liquida),
      spend,
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      reach: Number(row.reach),
      linkClicks: Number(row.link_clicks),
      landingPageViews: Number(row.landing_page_views),
      initiateCheckout: Number(row.initiate_checkout),
      roas: spend > 0 ? receitaBruta / spend : null,
      cac: vendas > 0 ? spend / vendas : null,
      spendSource: row.spend_source,
    }
  })
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
  const { data, error } = await db.rpc('get_funnel_payment_breakdown', {
    p_sales_funnel_id: salesFunnelId,
    p_since: since,
    p_until: until,
  })
  if (error) throw error
  return ((data ?? []) as { metodo: string; receita: number }[]).map((row) => ({ metodo: row.metodo, receita: Number(row.receita) }))
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
