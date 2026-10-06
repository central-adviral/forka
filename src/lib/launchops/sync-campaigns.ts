import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

// Every campaign the client's LaunchOps knows about, operation or not: the operation mapping there
// stopped being maintained, and projects now pick campaigns through fronts (0053, 0054).
//
// Spend is summed from the per-ad table (anuncio_dia): its totals are the ones that match the
// fronts and the creative numbers (data review of 2026-10-06). Leads only exist per ad set, so they
// still come from meta_ads_daily -- they are a count shown beside the spend, never a cost base.

export interface LaunchOpsAdDayRow {
  data_referencia: string
  spend: number | string | null
  impressions: number | null
  clicks: number | null
  reach: number | null
  link_clicks: number | null
  landing_page_views: number | null
  initiate_checkout: number | null
  updated_at: string
  anuncio: { campaign_id: string | null; campaign_name: string | null } | null
}

export interface LaunchOpsCampaignLeadsRow {
  data_referencia: string
  campaign_id: string | null
  leads_periodo: number | null
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
  /** Newest LaunchOps updated_at behind this row: how fresh the Meta numbers are. */
  source_updated_at: string
}

// The Meta keeps adjusting the last days, so they are always re-read whole. A client with nothing
// synced yet gets a longer first load, enough to cover a launch that is already running.
export const RECENT_DAYS = 7
export const FIRST_LOAD_DAYS = 60
// Longer than the route's maxDuration: a run that dies keeps the client for at most this long.
export const LEASE_SECONDS = 300

export async function fetchLaunchOpsAdDayRows(launchopsDb: SupabaseClient, params: { since: string }): Promise<LaunchOpsAdDayRow[]> {
  // Ordered by the primary key: paging an unordered result can skip or repeat rows between pages.
  return fetchAllPages<LaunchOpsAdDayRow>((from, to) =>
    launchopsDb
      .from('anuncio_dia')
      .select(
        'data_referencia, spend, impressions, clicks, reach, link_clicks, landing_page_views, initiate_checkout, updated_at, anuncio!inner(campaign_id, campaign_name)'
      )
      .gte('data_referencia', params.since)
      .order('id', { ascending: true })
      .range(from, to)
      // anuncio_dia -> anuncio is many-to-one, so the embed is one object, not the array the
      // untyped client infers.
      .overrideTypes<LaunchOpsAdDayRow[], { merge: false }>()
  )
}

export async function fetchLaunchOpsCampaignLeads(
  launchopsDb: SupabaseClient,
  params: { since: string }
): Promise<LaunchOpsCampaignLeadsRow[]> {
  return fetchAllPages<LaunchOpsCampaignLeadsRow>((from, to) =>
    launchopsDb
      .from('meta_ads_daily')
      .select('data_referencia, campaign_id, leads_periodo')
      .gte('data_referencia', params.since)
      .gt('leads_periodo', 0)
      .order('id', { ascending: true })
      .range(from, to)
  )
}

/** anuncio_dia is per ad; the Central counts per campaign and day. */
export function aggregateAdDays(rows: LaunchOpsAdDayRow[], leads: LaunchOpsCampaignLeadsRow[] = []): CampaignDay[] {
  const leadsByKey = new Map<string, number>()
  for (const row of leads) {
    if (!row.campaign_id) continue
    const key = `${row.data_referencia}|${row.campaign_id}`
    leadsByKey.set(key, (leadsByKey.get(key) ?? 0) + (row.leads_periodo ?? 0))
  }

  const byKey = new Map<string, CampaignDay>()
  const nameUpdatedAt = new Map<string, string>()
  for (const row of rows) {
    const campaignId = row.anuncio?.campaign_id
    if (!campaignId) continue
    const key = `${row.data_referencia}|${campaignId}`
    const name = row.anuncio?.campaign_name ?? ''
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, {
        data: row.data_referencia,
        campaign_id: campaignId,
        campaign_name: name,
        spend: Number(row.spend ?? 0),
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        link_clicks: row.link_clicks ?? 0,
        landing_page_views: row.landing_page_views ?? 0,
        leads: leadsByKey.get(key) ?? 0,
        reach: row.reach ?? 0,
        initiate_checkout: row.initiate_checkout ?? 0,
        source_updated_at: row.updated_at,
      })
      nameUpdatedAt.set(key, row.updated_at)
      continue
    }
    current.spend += Number(row.spend ?? 0)
    current.impressions += row.impressions ?? 0
    current.clicks += row.clicks ?? 0
    current.link_clicks += row.link_clicks ?? 0
    current.landing_page_views += row.landing_page_views ?? 0
    current.reach += row.reach ?? 0
    current.initiate_checkout += row.initiate_checkout ?? 0
    if (row.updated_at > current.source_updated_at) current.source_updated_at = row.updated_at
    // A campaign renamed mid-day shows both names; the newest is the one the rules should see.
    if (name && row.updated_at > (nameUpdatedAt.get(key) ?? '')) {
      current.campaign_name = name
      nameUpdatedAt.set(key, row.updated_at)
    }
  }
  return [...byKey.values()].map((day) => ({ ...day, spend: Math.round(day.spend * 100) / 100 }))
}

function saoPauloToday(now: Date): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
}

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function syncWindowStart(hasHistory: boolean, now: Date = new Date()): string {
  const days = hasHistory ? RECENT_DAYS : FIRST_LOAD_DAYS
  // São Paulo calendar day, the one LaunchOps' data_referencia is written in.
  const today = saoPauloToday(now)
  today.setDate(today.getDate() - days)
  return isoDay(today)
}

/** Every São Paulo day from `since` through today, including the ones LaunchOps has no row for. */
export function windowDays(since: string, now: Date = new Date()): string[] {
  const today = isoDay(saoPauloToday(now))
  const days: string[] = []
  const cursor = new Date(`${since}T12:00:00Z`)
  while (cursor.toISOString().slice(0, 10) <= today) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export interface CampaignSyncResult {
  since: string
  campaignDays: number
  frozenOwners: number
  skipped?: 'locked'
}

export async function syncCampaignsForClient(
  appDb: SupabaseClient,
  launchopsDb: SupabaseClient,
  clientId: string,
  now: Date = new Date()
): Promise<CampaignSyncResult> {
  const { data: claimed, error: claimError } = await appDb.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: LEASE_SECONDS })
  if (claimError) throw claimError
  if (!claimed) return { since: '', campaignDays: 0, frozenOwners: 0, skipped: 'locked' }

  const { data: run, error: runError } = await appDb
    .from('sync_runs')
    .insert({ client_id: clientId, kind: 'campaigns' })
    .select('id')
    .single()
  if (runError) throw runError

  try {
    const { count, error: countError } = await appDb
      .from('campaign_daily')
      .select('campaign_id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (countError) throw countError

    const since = syncWindowStart((count ?? 0) > 0, now)
    const [adRows, leadRows] = await Promise.all([
      fetchLaunchOpsAdDayRows(launchopsDb, { since }),
      fetchLaunchOpsCampaignLeads(launchopsDb, { since }),
    ])
    const days = aggregateAdDays(adRows, leadRows)
    const byDay = new Map<string, CampaignDay[]>()
    for (const day of days) byDay.set(day.data, [...(byDay.get(day.data) ?? []), day])

    // Each day is replaced whole, in its own transaction: a campaign LaunchOps no longer has spend
    // for on that day leaves the Central instead of keeping its old number (0056).
    for (const data of windowDays(since, now)) {
      // The extra `data` key on each row is ignored by jsonb_to_recordset.
      const { error } = await appDb.rpc('replace_campaign_day', { p_client_id: clientId, p_data: data, p_rows: byDay.get(data) ?? [] })
      if (error) throw error
    }

    // A campaign the rules match exactly once gets that front frozen as its owner (0054), so a
    // rename in the Ads Manager does not move its history to another front.
    const { data: frozen, error: freezeError } = await appDb.rpc('freeze_campaign_fronts', { p_client_id: clientId })
    if (freezeError) throw freezeError

    await appDb
      .from('sync_runs')
      .update({ finished_at: new Date().toISOString(), rows_read: adRows.length, rows_written: days.length })
      .eq('id', run.id)
    return { since, campaignDays: days.length, frozenOwners: Number(frozen ?? 0) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err)
    await appDb.from('sync_runs').update({ finished_at: new Date().toISOString(), error: message }).eq('id', run.id)
    throw err
  } finally {
    await appDb.rpc('release_sync_lease', { p_client_id: clientId })
  }
}
