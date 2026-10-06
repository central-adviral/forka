import type { SupabaseClient } from '@supabase/supabase-js'

// `since`/`until` are plain date strings (e.g. "2026-08-04") read as São Paulo calendar days: the
// SQL functions bound data_venda by BRT midnight and bucket each sale by its BRT day, so a sale
// near midnight lands on the same day the report shows it under.

export interface DailyFunnelRow {
  data: string
  /** Entry sales of any origin: the CPA base of the project overview. */
  vendas: number
  /** Entry sales the UTM ties to an ad: the CPA base of creatives, campaigns and tests. */
  vendasAnuncio: number
  vendasUpsell: number
  receitaBruta: number
  receitaLiquida: number
  spend: number
  /** Spend with the client's Meta tax applied for that day (0055); equals spend when none is set. */
  spendComImposto: number
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
  /** Today only: the moment of the last Meta pull. Today's sales above are cut there (0057). */
  dadosAte: string | null
  /** Today only: sales that arrived after that pull, left out of the day's CPA. */
  vendasAposDados: number
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
    vendas_anuncio: number
    vendas_upsell: number
    receita_bruta: number
    receita_liquida: number
    spend: number
    spend_com_imposto: number
    impressions: number
    clicks: number
    reach: number
    link_clicks: number
    landing_page_views: number
    initiate_checkout: number
    spend_source: 'frentes' | 'operacao'
    dados_ate: string | null
    vendas_apos_dados: number
  }[]).map((row) => {
    const vendas = Number(row.vendas)
    const spendComImposto = Number(row.spend_com_imposto)
    const receitaBruta = Number(row.receita_bruta)
    return {
      data: row.data,
      vendas,
      vendasAnuncio: Number(row.vendas_anuncio),
      vendasUpsell: Number(row.vendas_upsell),
      receitaBruta,
      receitaLiquida: Number(row.receita_liquida),
      spend: Number(row.spend),
      spendComImposto,
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      reach: Number(row.reach),
      linkClicks: Number(row.link_clicks),
      landingPageViews: Number(row.landing_page_views),
      initiateCheckout: Number(row.initiate_checkout),
      roas: spendComImposto > 0 ? receitaBruta / spendComImposto : null,
      cac: vendas > 0 ? spendComImposto / vendas : null,
      spendSource: row.spend_source,
      dadosAte: row.dados_ate,
      vendasAposDados: Number(row.vendas_apos_dados ?? 0),
    }
  })
}

export interface SalesByOrigin {
  origem: string
  vendas: number
  vendasUpsell: number
  receitaBruta: number
}

export async function getSalesByOrigin(db: SupabaseClient, salesFunnelId: string, since: string, until: string): Promise<SalesByOrigin[]> {
  const { data, error } = await db.rpc('get_funnel_sales_by_origin', { p_sales_funnel_id: salesFunnelId, p_since: since, p_until: until })
  if (error) throw error
  return ((data ?? []) as { origem: string; vendas: number; vendas_upsell: number; receita_bruta: number }[]).map((row) => ({
    origem: row.origem,
    vendas: Number(row.vendas),
    vendasUpsell: Number(row.vendas_upsell),
    receitaBruta: Number(row.receita_bruta),
  }))
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
