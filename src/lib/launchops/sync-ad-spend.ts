import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsAdSpendRow {
  operacao_id: string
  data_referencia: string
  spend: number
  impressions: number
  clicks: number
  leads_periodo: number
  updated_at: string
}

export interface AggregatedAdSpendRow {
  operacao_id: string
  data: string
  spend: number
  impressions: number
  clicks: number
  leads: number
}

export async function fetchLaunchOpsAdSpendRows(
  launchopsDb: SupabaseClient,
  params: { operacaoIds: string[]; since: string | null }
): Promise<LaunchOpsAdSpendRow[]> {
  let query = launchopsDb
    .from('meta_ads_daily')
    .select('operacao_id, data_referencia, spend, impressions, clicks, leads_periodo, updated_at')
    .in('operacao_id', params.operacaoIds)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsAdSpendRow[]
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return rows
}

export async function fetchLaunchOpsAdSpendRowsForDays(
  launchopsDb: SupabaseClient,
  params: { operacaoIds: string[]; days: string[] }
): Promise<LaunchOpsAdSpendRow[]> {
  if (params.days.length === 0) return []
  // PostgREST caps a single response at ~1000 rows — a full-day read that hits the cap would
  // otherwise silently truncate and upsert a spend total lower than reality (same clobber
  // class the incremental-vs-full-day fix exists to prevent). Page through the full result.
  return fetchAllPages<LaunchOpsAdSpendRow>((from, to) =>
    launchopsDb
      .from('meta_ads_daily')
      .select('operacao_id, data_referencia, spend, impressions, clicks, leads_periodo, updated_at')
      .in('operacao_id', params.operacaoIds)
      .in('data_referencia', params.days)
      .range(from, to)
  )
}

export function aggregateAdSpendByOperacaoDay(rows: LaunchOpsAdSpendRow[]): AggregatedAdSpendRow[] {
  const byKey = new Map<string, AggregatedAdSpendRow>()
  for (const row of rows) {
    const key = `${row.operacao_id}|${row.data_referencia}`
    const existing = byKey.get(key) ?? {
      operacao_id: row.operacao_id,
      data: row.data_referencia,
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
    }
    existing.spend += row.spend
    existing.impressions += row.impressions
    existing.clicks += row.clicks
    existing.leads += row.leads_periodo
    byKey.set(key, existing)
  }
  return [...byKey.values()]
}

export async function syncAdSpendForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: AggregatedAdSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    operacao_id: row.operacao_id,
    data: row.data,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    leads: row.leads,
    updated_at: new Date().toISOString(),
  }))

  // Same batching rationale as syncSalesForFunnel: bound each upsert regardless of how
  // many days a full-history sync ends up aggregating.
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error } = await appDb.from('ad_spend_daily').upsert(batch, { onConflict: 'sales_funnel_id,source,operacao_id,data' })
    if (error) throw error
  }
  return { synced: payload.length }
}
