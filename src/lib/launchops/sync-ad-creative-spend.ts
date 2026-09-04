import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

export interface LaunchOpsAdCreative {
  id: string
  ad_id: string | null
  ad_name: string | null
}

export interface LaunchOpsAdCreativeSpendRow {
  anuncio_id: string
  data_referencia: string
  spend: number
  impressions: number
  link_clicks: number
  updated_at: string
}

export interface JoinedAdCreativeSpendRow {
  ad_id: string | null
  ad_name: string | null
  data: string
  spend: number
  impressions: number
  link_clicks: number
}

export async function fetchLaunchOpsAdCreatives(
  launchopsDb: SupabaseClient,
  operacaoIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const { data, error } = await launchopsDb.from('anuncio').select('id, ad_id, ad_name').in('operacao_id', operacaoIds)
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreative[]
}

export async function fetchLaunchOpsAdCreativeSpendRows(
  launchopsDb: SupabaseClient,
  params: { anuncioIds: string[]; since: string | null }
): Promise<LaunchOpsAdCreativeSpendRow[]> {
  if (params.anuncioIds.length === 0) return []
  // PostgREST caps a single response at ~1000 rows — a full-history first sync (since=null)
  // that hits the cap would otherwise silently truncate and advance the cursor past
  // everything still unsynced. Page through the full result, same fix as ad spend.
  return fetchAllPages<LaunchOpsAdCreativeSpendRow>((from, to) => {
    let query = launchopsDb
      .from('anuncio_dia')
      .select('anuncio_id, data_referencia, spend, impressions, link_clicks, updated_at')
      .in('anuncio_id', params.anuncioIds)
      .order('updated_at', { ascending: true })
      .range(from, to)
    if (params.since) query = query.gt('updated_at', params.since)
    return query
  })
}

export function joinAdCreativeSpend(
  creatives: LaunchOpsAdCreative[],
  spendRows: LaunchOpsAdCreativeSpendRow[]
): JoinedAdCreativeSpendRow[] {
  const creativeById = new Map(creatives.map((c) => [c.id, c]))
  const joined: JoinedAdCreativeSpendRow[] = []
  for (const row of spendRows) {
    const creative = creativeById.get(row.anuncio_id)
    if (!creative) continue
    joined.push({
      ad_id: creative.ad_id,
      ad_name: creative.ad_name,
      data: row.data_referencia,
      spend: row.spend,
      impressions: row.impressions,
      link_clicks: row.link_clicks,
    })
  }
  return joined
}

export async function syncAdCreativeSpendForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: JoinedAdCreativeSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: row.data,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    spend: row.spend,
    impressions: row.impressions,
    link_clicks: row.link_clicks,
    updated_at: new Date().toISOString(),
  }))

  // Same batching rationale as syncSalesForFunnel: bound each upsert regardless of how
  // many ad/day rows a full-history sync ends up joining.
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error } = await appDb
      .from('ad_creative_spend_daily')
      .upsert(batch, { onConflict: 'sales_funnel_id,source,data,ad_id,ad_name' })
    if (error) throw error
  }
  return { synced: payload.length }
}
