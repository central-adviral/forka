import type { SupabaseClient } from '@supabase/supabase-js'

export interface ClientDay {
  data: string
  spend: number
  spendComImposto: number
  leads: number
  vendas: number
  vendasAnuncio: number
  receitaLiquida: number
  /** Today only: the last Meta pull; today's sales are cut there (0058). */
  dadosAte: string | null
  vendasAposDados: number
  /** Spend by the owner project's result (0090): CPA uses compra, CPL uses lead. */
  spendCompraComImposto: number
  spendLeadComImposto: number
  spendSemFrenteComImposto: number
  vendasSemProjeto: number
  /** Refunds dated on this day (0099); receitaLiquida is already net of them. */
  reembolsos: number
}

export async function getClientDaily(db: SupabaseClient, clientId: string, since: string, until: string): Promise<ClientDay[]> {
  const { data, error } = await db.rpc('get_client_daily', { p_client_id: clientId, p_since: since, p_until: until })
  if (error) throw error
  return ((data ?? []) as {
    data: string
    spend: number
    spend_com_imposto: number
    leads: number
    vendas: number
    vendas_anuncio: number
    receita_liquida: number
    dados_ate: string | null
    vendas_apos_dados: number
    spend_compra_com_imposto: number
    spend_lead_com_imposto: number
    spend_sem_frente_com_imposto: number
    vendas_sem_projeto: number
    reembolsos: number
  }[]).map((row) => ({
    data: row.data,
    spend: Number(row.spend),
    spendComImposto: Number(row.spend_com_imposto),
    leads: Number(row.leads),
    vendas: Number(row.vendas),
    vendasAnuncio: Number(row.vendas_anuncio),
    receitaLiquida: Number(row.receita_liquida),
    dadosAte: row.dados_ate,
    vendasAposDados: Number(row.vendas_apos_dados),
    spendCompraComImposto: Number(row.spend_compra_com_imposto),
    spendLeadComImposto: Number(row.spend_lead_com_imposto),
    spendSemFrenteComImposto: Number(row.spend_sem_frente_com_imposto),
    vendasSemProjeto: Number(row.vendas_sem_projeto),
    reembolsos: Number(row.reembolsos),
  }))
}

/** São Paulo calendar day, `offset` days from today, as YYYY-MM-DD. */
export function saoPauloDay(offset = 0, now: Date = new Date()): string {
  return new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
