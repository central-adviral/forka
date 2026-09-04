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
  transaction_id_plataforma: string | null
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
      .select(
        'id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at, transaction_id_plataforma'
      )
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

async function findConversionIdsByExternalEventId(
  appDb: SupabaseClient,
  externalEventIds: string[]
): Promise<Map<string, string>> {
  const conversionIdByExternalEventId = new Map<string, string>()
  if (externalEventIds.length === 0) return conversionIdByExternalEventId

  const { data, error } = await appDb.from('conversions').select('id, external_event_id').in('external_event_id', externalEventIds)
  if (error) throw error
  for (const conversion of data ?? []) {
    if (conversion.external_event_id) conversionIdByExternalEventId.set(conversion.external_event_id, conversion.id)
  }
  return conversionIdByExternalEventId
}

export async function syncSalesForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: LaunchOpsSaleRow[]
): Promise<{ synced: number; latestUpdatedAt: string | null }> {
  if (rows.length === 0) return { synced: 0, latestUpdatedAt: null }

  // Best-effort reconciliation: transaction_id_plataforma (LaunchOps) and conversions.external_event_id
  // (ab-test-tool) both hold the Hubla invoice id. Most sales won't have a match — that's expected,
  // not an error. One lookup for the whole batch, before it gets sliced into write batches below.
  const transactionIds = [...new Set(rows.map((row) => row.transaction_id_plataforma).filter((id): id is string => Boolean(id)))]
  const conversionIdByTransactionId = await findConversionIdsByExternalEventId(appDb, transactionIds)

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
    transaction_id_plataforma: row.transaction_id_plataforma,
    conversion_id: row.transaction_id_plataforma ? conversionIdByTransactionId.get(row.transaction_id_plataforma) ?? null : null,
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
