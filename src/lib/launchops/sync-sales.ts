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
  // Optional: a LaunchOps row predating the UTM columns simply omits them.
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
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
        'id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at, transaction_id_plataforma, utm_source, utm_medium, utm_campaign, utm_term, utm_content'
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
const LOOKUP_CHUNK_SIZE = 200

// PostgREST/Kong's GET query-string budget caps an `.in()` filter around 200-650 ids —
// well below a first full-history sync's volume. Chunk the lookup the same way the
// write path below is already batched, merging results into one Map.
export async function findConversionIdsByExternalEventId(
  appDb: SupabaseClient,
  externalEventIds: string[],
  chunkSize = LOOKUP_CHUNK_SIZE
): Promise<Map<string, string>> {
  const conversionIdByExternalEventId = new Map<string, string>()
  if (externalEventIds.length === 0) return conversionIdByExternalEventId

  for (let i = 0; i < externalEventIds.length; i += chunkSize) {
    const chunk = externalEventIds.slice(i, i + chunkSize)
    const { data, error } = await appDb.from('conversions').select('id, external_event_id').in('external_event_id', chunk)
    if (error) throw error
    for (const conversion of data ?? []) {
      if (conversion.external_event_id) conversionIdByExternalEventId.set(conversion.external_event_id, conversion.id)
    }
  }
  return conversionIdByExternalEventId
}

const RECONCILE_LOOKBACK_DAYS = 90
const RECONCILE_ROW_LIMIT = 500

// A sale that syncs before its conversion exists (webhook lands late, or the sale is synced
// first) stays with conversion_id null forever: the incremental sync only revisits rows whose
// updated_at moved. This second pass re-checks recent unmatched sales on every sync.
export async function reconcileUnmatchedSales(
  appDb: SupabaseClient,
  salesFunnelId: string,
  now: Date = new Date()
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: pending, error } = await appDb
    .from('sales')
    .select('id, transaction_id_plataforma')
    .eq('sales_funnel_id', salesFunnelId)
    .is('conversion_id', null)
    .not('transaction_id_plataforma', 'is', null)
    .gte('data_venda', since)
    .limit(RECONCILE_ROW_LIMIT)
  if (error) throw error
  if (!pending || pending.length === 0) return { reconciled: 0 }

  const transactionIds = [
    ...new Set(pending.map((row) => row.transaction_id_plataforma).filter((id): id is string => Boolean(id))),
  ]
  const conversionIdByTransactionId = await findConversionIdsByExternalEventId(appDb, transactionIds)
  if (conversionIdByTransactionId.size === 0) return { reconciled: 0 }

  let reconciled = 0
  for (const sale of pending) {
    const conversionId = sale.transaction_id_plataforma
      ? conversionIdByTransactionId.get(sale.transaction_id_plataforma)
      : undefined
    if (!conversionId) continue
    const { error: updateError } = await appDb.from('sales').update({ conversion_id: conversionId }).eq('id', sale.id)
    if (updateError) throw updateError
    reconciled++
  }
  return { reconciled }
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
    // LaunchOps records the ad on the sale itself; carrying it over is what lets revenue be
    // read per creative for every sale, not only for the ones that came through a test.
    utm_source: row.utm_source ?? null,
    utm_medium: row.utm_medium ?? null,
    utm_campaign: row.utm_campaign ?? null,
    utm_term: row.utm_term ?? null,
    utm_content: row.utm_content ?? null,
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
