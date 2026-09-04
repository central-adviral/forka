import type { SupabaseClient } from '@supabase/supabase-js'

export interface DailyFunnelRow {
  data: string
  vendas: number
  receitaBruta: number
  receitaLiquida: number
  spend: number
  roas: number | null
  cac: number | null
}

export async function getDailyFunnel(
  db: SupabaseClient,
  clientId: string,
  since: string,
  until: string
): Promise<DailyFunnelRow[]> {
  const { data: salesRows, error: salesError } = await db
    .from('sales')
    .select('data_venda, valor_bruto, valor_liquido')
    .eq('client_id', clientId)
    .gte('data_venda', since)
    .lt('data_venda', until)
  if (salesError) throw salesError

  const { data: spendRows, error: spendError } = await db
    .from('ad_spend_daily')
    .select('data, spend')
    .eq('client_id', clientId)
    .gte('data', since)
    .lt('data', until)
  if (spendError) throw spendError

  const byDay = new Map<string, { vendas: number; receitaBruta: number; receitaLiquida: number; spend: number }>()
  const dayKey = (iso: string) => iso.slice(0, 10)

  for (const row of (salesRows ?? []) as { data_venda: string; valor_bruto: number | null; valor_liquido: number | null }[]) {
    const key = dayKey(row.data_venda)
    const entry = byDay.get(key) ?? { vendas: 0, receitaBruta: 0, receitaLiquida: 0, spend: 0 }
    entry.vendas += 1
    entry.receitaBruta += row.valor_bruto ?? 0
    entry.receitaLiquida += row.valor_liquido ?? 0
    byDay.set(key, entry)
  }

  for (const row of (spendRows ?? []) as { data: string; spend: number }[]) {
    const entry = byDay.get(row.data) ?? { vendas: 0, receitaBruta: 0, receitaLiquida: 0, spend: 0 }
    entry.spend += row.spend
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

export interface SyncHealth {
  entity: string
  lastRunAt: string | null
  lastResult: string | null
  lastMessage: string | null
}

export async function getFunnelSyncHealth(db: SupabaseClient, clientId: string): Promise<SyncHealth[]> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('entity, last_run_at, last_result, last_message')
    .eq('client_id', clientId)
  if (error) throw error
  return ((data ?? []) as { entity: string; last_run_at: string | null; last_result: string | null; last_message: string | null }[]).map(
    (row) => ({ entity: row.entity, lastRunAt: row.last_run_at, lastResult: row.last_result, lastMessage: row.last_message })
  )
}
