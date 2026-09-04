import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

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
  // PostgREST caps a single response at ~1000 rows — a full-history first sync (since=null)
  // that hits the cap would otherwise silently truncate and advance the cursor past
  // everything still unsynced. Page through the full result, same fix as ad spend.
  return fetchAllPages<LaunchOpsSaleRow>((from, to) => {
    let query = launchopsDb
      .from('vendas')
      .select('id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at')
      .eq('plataforma', 'hubla')
      .eq('status', 'aprovada')
      .in('produto_nome', params.produtoNomes)
      .order('updated_at', { ascending: true })
      .range(from, to)
    if (params.since) query = query.gt('updated_at', params.since)
    return query
  })
}

const UPSERT_BATCH_SIZE = 500

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

  // A single upsert covering thousands of rows (e.g. a first full-history sync) risks
  // hitting a request-size or statement-timeout limit. Write in bounded batches instead.
  for (let i = 0; i < payload.length; i += UPSERT_BATCH_SIZE) {
    const batch = payload.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await appDb.from('sales').upsert(batch, { onConflict: 'sales_funnel_id,source,external_id' })
    if (error) throw error
  }

  const latestUpdatedAt = rows[rows.length - 1].updated_at
  return { synced: rows.length, latestUpdatedAt }
}
