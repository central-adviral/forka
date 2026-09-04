import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsSaleRow {
  id: string
  data_venda: string
  produto_nome: string | null
  status: string
  valor_bruto: number | null
  valor_liquido: number | null
  metodo_pagamento: string | null
  updated_at: string
}

export async function fetchLaunchOpsSalesRows(
  launchopsDb: SupabaseClient,
  params: { produtoNomes: string[]; since: string | null }
): Promise<LaunchOpsSaleRow[]> {
  let query = launchopsDb
    .from('vendas')
    .select('id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at')
    .eq('plataforma', 'hubla')
    .eq('status', 'aprovada')
    .in('produto_nome', params.produtoNomes)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsSaleRow[]
}

export async function syncSalesForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: LaunchOpsSaleRow[]
): Promise<{ synced: number; latestUpdatedAt: string | null }> {
  if (rows.length === 0) return { synced: 0, latestUpdatedAt: null }

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    external_id: row.id,
    data_venda: row.data_venda,
    produto: row.produto_nome,
    status: row.status,
    valor_bruto: row.valor_bruto,
    valor_liquido: row.valor_liquido,
    metodo_pagamento: row.metodo_pagamento,
    updated_at: row.updated_at,
  }))

  const { error } = await appDb.from('sales').upsert(payload, { onConflict: 'sales_funnel_id,source,external_id' })
  if (error) throw error

  const latestUpdatedAt = rows[rows.length - 1].updated_at
  return { synced: rows.length, latestUpdatedAt }
}
