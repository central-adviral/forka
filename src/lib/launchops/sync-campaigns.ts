import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

// Every campaign the client's LaunchOps knows about, operation or not: the operation mapping there
// stopped being maintained, and projects now pick campaigns by name (0053_campaigns_and_fronts).

export interface LaunchOpsCampaignRow {
  data_referencia: string
  campaign_id: string | null
  campaign_name: string | null
  spend: number | string | null
  impressions: number | null
  clicks: number | null
  link_clicks: number | null
  landing_page_views: number | null
  leads_periodo: number | null
  reach: number | null
  updated_at: string
}

export interface LaunchOpsCheckoutRow {
  data_referencia: string
  initiate_checkout: number | null
  anuncio: { campaign_id: string | null } | null
}

export interface CampaignDay {
  data: string
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  landing_page_views: number
  leads: number
  reach: number
  initiate_checkout: number
}

// The Meta keeps adjusting the last days, so they are always re-read whole. A client with nothing
// synced yet gets a longer first load, enough to cover a launch that is already running.
export const RECENT_DAYS = 7
export const FIRST_LOAD_DAYS = 60

const COLUMNS =
  'data_referencia, campaign_id, campaign_name, spend, impressions, clicks, link_clicks, landing_page_views, leads_periodo, reach, updated_at'

export async function fetchLaunchOpsCampaignRows(
  launchopsDb: SupabaseClient,
  params: { since: string }
): Promise<LaunchOpsCampaignRow[]> {
  // Ordered by the primary key: paging an unordered result can skip or repeat rows between pages.
  return fetchAllPages<LaunchOpsCampaignRow>((from, to) =>
    launchopsDb
      .from('meta_ads_daily')
      .select(COLUMNS)
      .gte('data_referencia', params.since)
      .order('id', { ascending: true })
      .range(from, to)
  )
}

// Initiate checkout is only recorded per ad (anuncio_dia); each ad knows its campaign.
export async function fetchLaunchOpsCheckoutRows(
  launchopsDb: SupabaseClient,
  params: { since: string }
): Promise<LaunchOpsCheckoutRow[]> {
  return fetchAllPages<LaunchOpsCheckoutRow>((from, to) =>
    launchopsDb
      .from('anuncio_dia')
      .select('data_referencia, initiate_checkout, anuncio!inner(campaign_id)')
      .gte('data_referencia', params.since)
      .gt('initiate_checkout', 0)
      .order('id', { ascending: true })
      .range(from, to)
      // anuncio_dia -> anuncio is many-to-one, so the embed is one object, not the array the
      // untyped client infers.
      .overrideTypes<LaunchOpsCheckoutRow[], { merge: false }>()
  )
}

/** Adds each campaign-day's initiate checkout; a day the campaign has no spend row for is dropped. */
export function attachCheckouts(days: CampaignDay[], checkouts: LaunchOpsCheckoutRow[]): CampaignDay[] {
  const byKey = new Map<string, number>()
  for (const row of checkouts) {
    const campaignId = row.anuncio?.campaign_id
    if (!campaignId) continue
    const key = `${row.data_referencia}|${campaignId}`
    byKey.set(key, (byKey.get(key) ?? 0) + (row.initiate_checkout ?? 0))
  }
  return days.map((day) => ({ ...day, initiate_checkout: byKey.get(`${day.data}|${day.campaign_id}`) ?? 0 }))
}

/** meta_ads_daily is per ad set; the Central counts per campaign and day. */
export function aggregateCampaignDays(rows: LaunchOpsCampaignRow[]): CampaignDay[] {
  const byKey = new Map<string, CampaignDay & { nameUpdatedAt: string }>()
  for (const row of rows) {
    if (!row.campaign_id) continue
    const key = `${row.data_referencia}|${row.campaign_id}`
    const current = byKey.get(key)
    const name = row.campaign_name ?? ''
    if (!current) {
      byKey.set(key, {
        data: row.data_referencia,
        campaign_id: row.campaign_id,
        campaign_name: name,
        nameUpdatedAt: row.updated_at,
        spend: Number(row.spend ?? 0),
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        link_clicks: row.link_clicks ?? 0,
        landing_page_views: row.landing_page_views ?? 0,
        leads: row.leads_periodo ?? 0,
        reach: row.reach ?? 0,
        initiate_checkout: 0,
      })
      continue
    }
    current.spend += Number(row.spend ?? 0)
    current.impressions += row.impressions ?? 0
    current.clicks += row.clicks ?? 0
    current.link_clicks += row.link_clicks ?? 0
    current.landing_page_views += row.landing_page_views ?? 0
    current.leads += row.leads_periodo ?? 0
    current.reach += row.reach ?? 0
    // A campaign renamed mid-day shows both names; the newest is the one the rules should see.
    if (name && row.updated_at > current.nameUpdatedAt) {
      current.campaign_name = name
      current.nameUpdatedAt = row.updated_at
    }
  }
  return [...byKey.values()].map((day) => ({
    data: day.data,
    campaign_id: day.campaign_id,
    campaign_name: day.campaign_name,
    spend: Math.round(day.spend * 100) / 100,
    impressions: day.impressions,
    clicks: day.clicks,
    link_clicks: day.link_clicks,
    landing_page_views: day.landing_page_views,
    leads: day.leads,
    reach: day.reach,
    initiate_checkout: day.initiate_checkout,
  }))
}

export function syncWindowStart(hasHistory: boolean, now: Date = new Date()): string {
  const days = hasHistory ? RECENT_DAYS : FIRST_LOAD_DAYS
  // São Paulo calendar day, the one LaunchOps' data_referencia is written in.
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  today.setDate(today.getDate() - days)
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export async function syncCampaignsForClient(
  appDb: SupabaseClient,
  launchopsDb: SupabaseClient,
  clientId: string,
  now: Date = new Date()
): Promise<{ since: string; campaignDays: number; frozenOwners: number }> {
  const { count, error: countError } = await appDb
    .from('campaign_daily')
    .select('campaign_id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (countError) throw countError

  const since = syncWindowStart((count ?? 0) > 0, now)
  const [spendRows, checkoutRows] = await Promise.all([
    fetchLaunchOpsCampaignRows(launchopsDb, { since }),
    fetchLaunchOpsCheckoutRows(launchopsDb, { since }),
  ])
  const days = attachCheckouts(aggregateCampaignDays(spendRows), checkoutRows)
  const syncedAt = new Date().toISOString()
  for (let i = 0; i < days.length; i += 500) {
    const chunk = days.slice(i, i + 500).map((day) => ({ ...day, client_id: clientId, synced_at: syncedAt }))
    const { error } = await appDb.from('campaign_daily').upsert(chunk, { onConflict: 'client_id,data,campaign_id' })
    if (error) throw error
  }
  // A campaign the rules match exactly once gets that front frozen as its owner (0054), so a
  // rename in the Ads Manager does not move its history to another front.
  const { data: frozen, error: freezeError } = await appDb.rpc('freeze_campaign_fronts', { p_client_id: clientId })
  if (freezeError) throw freezeError
  return { since, campaignDays: days.length, frozenOwners: Number(frozen ?? 0) }
}
