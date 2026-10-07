import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

export interface LaunchOpsAdCreative {
  id: string
  ad_id: string | null
  ad_name: string | null
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
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
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  data: string
  spend: number
  impressions: number
  link_clicks: number
  /** Unique paid leads the ad brought that day (0072); absent on the operation path. */
  leads?: number
}

export async function fetchLaunchOpsAdCreatives(
  launchopsDb: SupabaseClient,
  operacaoIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const { data, error } = await launchopsDb
    .from('anuncio')
    .select('id, ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name')
    .in('operacao_id', operacaoIds)
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreative[]
}

const AD_ID_LOOKUP_CHUNK = 200

// An ad duplicated in Meta lands in LaunchOps with operacao_id null until someone classifies it,
// and null never matches the operation filter above -- so its spend was skipped in silence even
// though LaunchOps had it recorded. Ads seen in this client's own clicks are therefore fetched by
// id as well, which keeps attribution working whether or not anyone got around to classifying them.
export async function fetchLaunchOpsAdCreativesByAdIds(
  launchopsDb: SupabaseClient,
  adIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  if (adIds.length === 0) return []
  const creatives: LaunchOpsAdCreative[] = []
  for (let i = 0; i < adIds.length; i += AD_ID_LOOKUP_CHUNK) {
    const { data, error } = await launchopsDb
      .from('anuncio')
      .select('id, ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name')
      .in('ad_id', adIds.slice(i, i + AD_ID_LOOKUP_CHUNK))
    if (error) throw error
    creatives.push(...((data ?? []) as LaunchOpsAdCreative[]))
  }
  return creatives
}

// The project's ads once its campaigns are picked by fronts (0053, 0054): every ad of a campaign
// whose owner front belongs to the project, whatever operation LaunchOps did or did not tag it with.
export async function fetchLaunchOpsAdCreativesByCampaignIds(
  launchopsDb: SupabaseClient,
  campaignIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const creatives: LaunchOpsAdCreative[] = []
  for (let i = 0; i < campaignIds.length; i += AD_ID_LOOKUP_CHUNK) {
    const { data, error } = await launchopsDb
      .from('anuncio')
      .select('id, ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name')
      .in('campaign_id', campaignIds.slice(i, i + AD_ID_LOOKUP_CHUNK))
    if (error) throw error
    creatives.push(...((data ?? []) as LaunchOpsAdCreative[]))
  }
  return creatives
}

export async function fetchLaunchOpsAdCreativeSpendRows(
  launchopsDb: SupabaseClient,
  params: { anuncioIds: string[]; since: string | null }
): Promise<LaunchOpsAdCreativeSpendRow[]> {
  const rows: LaunchOpsAdCreativeSpendRow[] = []
  // Chunked: a project picked by fronts can hold more ads than one `in` filter fits in the URL.
  for (let i = 0; i < params.anuncioIds.length; i += AD_ID_LOOKUP_CHUNK) {
    const chunk = params.anuncioIds.slice(i, i + AD_ID_LOOKUP_CHUNK)
    // PostgREST caps a single response at ~1000 rows — a full-history first sync (since=null)
    // that hits the cap would otherwise silently truncate and advance the cursor past
    // everything still unsynced. Page through the full result, same fix as ad spend.
    rows.push(
      ...(await fetchAllPages<LaunchOpsAdCreativeSpendRow>((from, to) => {
        let query = launchopsDb
          .from('anuncio_dia')
          .select('anuncio_id, data_referencia, spend, impressions, link_clicks, updated_at')
          .in('anuncio_id', chunk)
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (params.since) query = query.gt('updated_at', params.since)
        return query
      }))
    )
  }
  return rows.sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0))
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
      campaign_id: creative.campaign_id,
      campaign_name: creative.campaign_name,
      adset_id: creative.adset_id,
      adset_name: creative.adset_name,
      data: row.data_referencia,
      spend: row.spend,
      impressions: row.impressions,
      link_clicks: row.link_clicks,
    })
  }
  return joined
}

/**
 * Unique paid leads per ad and São Paulo day, keyed "day|ad_id". A paid lead carries the ad id in
 * captacao_content (the same leads the campaign sync counts per campaign); duplicates are left out.
 */
export async function fetchLaunchOpsAdLeads(launchopsDb: SupabaseClient, adIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (let i = 0; i < adIds.length; i += AD_ID_LOOKUP_CHUNK) {
    const chunk = adIds.slice(i, i + AD_ID_LOOKUP_CHUNK)
    const rows = await fetchAllPages<{ data_captacao: string; captacao_content: string }>((from, to) =>
      launchopsDb
        .from('leads')
        .select('data_captacao, captacao_content')
        .eq('captacao_medium', 'paid')
        .not('is_duplicata', 'is', true)
        .in('captacao_content', chunk)
        .order('id', { ascending: true })
        .range(from, to)
    )
    for (const row of rows) {
      const day = new Date(new Date(row.data_captacao).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const key = `${day}|${row.captacao_content}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}
/**
 * Puts each ad's leads on its spend row of the same day. A day with leads and no spend row (the
 * lead came in after the ad stopped spending) gets a zero-spend row, so no lead is dropped.
 */
export function mergeAdLeads(
  joined: JoinedAdCreativeSpendRow[],
  creatives: LaunchOpsAdCreative[],
  leadsByDayAd: Map<string, number>
): JoinedAdCreativeSpendRow[] {
  const remaining = new Map(leadsByDayAd)
  const merged = joined.map((row) => {
    const key = `${row.data}|${row.ad_id}`
    const leads = row.ad_id ? remaining.get(key) : undefined
    if (leads === undefined) return { ...row, leads: 0 }
    remaining.delete(key)
    return { ...row, leads }
  })
  const creativeByAdId = new Map(creatives.filter((creative) => creative.ad_id).map((creative) => [creative.ad_id as string, creative]))
  for (const [key, leads] of remaining) {
    const [day, adId] = key.split('|')
    const creative = creativeByAdId.get(adId)
    if (!creative) continue
    merged.push({
      ad_id: creative.ad_id,
      ad_name: creative.ad_name,
      campaign_id: creative.campaign_id,
      campaign_name: creative.campaign_name,
      adset_id: creative.adset_id,
      adset_name: creative.adset_name,
      data: day,
      spend: 0,
      impressions: 0,
      link_clicks: 0,
      leads,
    })
  }
  return merged
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
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    adset_id: row.adset_id,
    adset_name: row.adset_name,
    spend: row.spend,
    impressions: row.impressions,
    link_clicks: row.link_clicks,
    leads: row.leads ?? 0,
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
