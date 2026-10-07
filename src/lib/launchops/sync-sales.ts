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
  is_upsell?: boolean | null
}

// Same row read twice is absorbed by the upsert; a row read zero times is lost for good. A long
// LaunchOps backfill commits rows whose updated_at is older than the cursor already stored, so
// every read starts this far behind it.
export const CURSOR_OVERLAP_MS = 60 * 60 * 1000

/** Only approved sales count. A row that left that status (refund, chargeback) leaves the Central. */
export const APPROVED_STATUS = 'aprovada'

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
        'id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at, transaction_id_plataforma, utm_source, utm_medium, utm_campaign, utm_term, utm_content, is_upsell'
      )
      // No platform filter: the product names already pick the project's sales, and the same
      // product is sold on more than one checkout (1K LATAM on Hubla and on Pagtrust).
      // Every status, not only approved: a refund is the same row changing status, and filtering it
      // out meant the Central never learned the sale was gone.
      .in('produto_nome', params.produtoNomes)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (params.since) query = query.gte('updated_at', new Date(new Date(params.since).getTime() - CURSOR_OVERLAP_MS).toISOString())
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
// updated_at moved. This second pass re-checks recent unmatched sales on every sync -- by client, so
// a sale no project owns (0073) is linked to its click as well.
export async function reconcileUnmatchedSales(
  appDb: SupabaseClient,
  clientId: string,
  now: Date = new Date()
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: pending, error } = await appDb
    .from('sales')
    .select('id, transaction_id_plataforma')
    .eq('client_id', clientId)
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
): Promise<{ synced: number; removed: number; latestUpdatedAt: string | null }> {
  if (rows.length === 0) return { synced: 0, removed: 0, latestUpdatedAt: null }
  const latestUpdatedAt = rows.reduce((latest, row) => (row.updated_at > latest ? row.updated_at : latest), rows[0].updated_at)
  const approved = rows.filter((row) => row.status === APPROVED_STATUS)
  const removedIds = rows.filter((row) => row.status !== APPROVED_STATUS).map((row) => row.id)

  // A sale is stored once per client (0073) and may sit in another project or in none, so a refund
  // removes it by client, wherever the attribution put it.
  let clientId: string | null = null
  if (removedIds.length > 0) {
    const { data: funnel, error: funnelError } = await appDb.from('sales_funnels').select('client_id').eq('id', salesFunnelId).single()
    if (funnelError) throw funnelError
    clientId = funnel.client_id as string
  }
  for (let i = 0; i < removedIds.length; i += LOOKUP_CHUNK_SIZE) {
    const { error } = await appDb
      .from('sales')
      .delete()
      .eq('client_id', clientId)
      .eq('source', 'launchops_sync')
      .in('external_id', removedIds.slice(i, i + LOOKUP_CHUNK_SIZE))
    if (error) throw error
  }
  if (approved.length === 0) return { synced: 0, removed: removedIds.length, latestUpdatedAt }

  // Best-effort reconciliation: transaction_id_plataforma (LaunchOps) and conversions.external_event_id
  // (ab-test-tool) both hold the Hubla invoice id. Most sales won't have a match — that's expected,
  // not an error. One lookup for the whole batch, before it gets sliced into write batches below.
  const transactionIds = [...new Set(approved.map((row) => row.transaction_id_plataforma).filter((id): id is string => Boolean(id)))]
  const conversionIdByTransactionId = await findConversionIdsByExternalEventId(appDb, transactionIds)

  // sales_funnel_id is a hint: the sales_attribute trigger (0073) picks the project from the
  // products and the ad, and fills client_id from it.
  const payload = approved.map((row) => ({
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
    is_upsell: row.is_upsell ?? false,
  }))

  // A single upsert covering thousands of rows (e.g. a first full-history sync) risks
  // hitting a request-size or statement-timeout limit. Write in bounded batches instead.
  for (let i = 0; i < payload.length; i += UPSERT_BATCH_SIZE) {
    const batch = payload.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await appDb.from('sales').upsert(batch, { onConflict: 'client_id,source,external_id' })
    if (error) throw error
  }

  return { synced: approved.length, removed: removedIds.length, latestUpdatedAt }
}
