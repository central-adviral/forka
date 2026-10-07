import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'

// Every campaign the client's LaunchOps knows about, operation or not: the operation mapping there
// stopped being maintained, and projects now pick campaigns through fronts (0053, 0054).
//
// Spend is summed from the per-ad table (anuncio_dia): its totals are the ones that match the
// fronts and the creative numbers (data review of 2026-10-06). Leads are counted from LaunchOps'
// own lead records (see fetchLaunchOpsCampaignLeads) -- a count beside the spend, never a cost base.

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

export interface LaunchOpsPaidLeadRow {
  data_captacao: string
  captacao_campaign: string | null
  captacao_content: string | null
}

const META_ID = /^[0-9]{6,}$/
const AD_LOOKUP_CHUNK = 200

// meta_ads_daily.leads_periodo was never filled. The leads themselves are in `leads`: a paid one
// (captacao_medium = 'paid') carries the Meta campaign id in captacao_campaign and the ad id in
// captacao_content. Some forms wrote a label ("MTV-T15-GER") where the campaign id goes; those are
// tied to their campaign through the ad id (2026-10-06 check: 344 of 344 carry a known ad id).
// Duplicates are left out, so the CPL is per person, not per form submission.
export async function fetchLaunchOpsCampaignLeads(
  launchopsDb: SupabaseClient,
  params: { since: string }
): Promise<LaunchOpsCampaignLeadsRow[]> {
  const rows = await fetchAllPages<LaunchOpsPaidLeadRow>((from, to) =>
    launchopsDb
      .from('leads')
      .select('data_captacao, captacao_campaign, captacao_content')
      .eq('captacao_medium', 'paid')
      .not('is_duplicata', 'is', true)
      .gte('data_captacao', brtDayBoundaryUtc(params.since))
      .order('id', { ascending: true })
      .range(from, to)
  )
  const adIds = [
    ...new Set(
      rows
        .filter((row) => !META_ID.test(row.captacao_campaign ?? '') && META_ID.test(row.captacao_content ?? ''))
        .map((row) => row.captacao_content as string)
    ),
  ]
  const campaignByAdId = new Map<string, string>()
  for (let i = 0; i < adIds.length; i += AD_LOOKUP_CHUNK) {
    const { data, error } = await launchopsDb
      .from('anuncio')
      .select('ad_id, campaign_id')
      .in('ad_id', adIds.slice(i, i + AD_LOOKUP_CHUNK))
    if (error) throw error
    for (const ad of (data ?? []) as { ad_id: string; campaign_id: string | null }[]) {
      if (ad.campaign_id) campaignByAdId.set(ad.ad_id, ad.campaign_id)
    }
  }
  return countPaidLeads(rows, campaignByAdId)
}

/** Paid leads per São Paulo day and campaign; a lead without a campaign id is placed by its ad. */
export function countPaidLeads(
  rows: LaunchOpsPaidLeadRow[],
  campaignByAdId: Map<string, string> = new Map()
): LaunchOpsCampaignLeadsRow[] {
  const byKey = new Map<string, LaunchOpsCampaignLeadsRow>()
  for (const row of rows) {
    const campaignId = META_ID.test(row.captacao_campaign ?? '')
      ? (row.captacao_campaign as string)
      : campaignByAdId.get(row.captacao_content ?? '')
    if (!campaignId) continue
    const day = new Date(new Date(row.data_captacao).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const key = `${day}|${campaignId}`
    const current = byKey.get(key) ?? { data_referencia: day, campaign_id: campaignId, leads_periodo: 0 }
    current.leads_periodo = (current.leads_periodo ?? 0) + 1
    byKey.set(key, current)
  }
  return [...byKey.values()]
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
    // An empty read with no error would replace every day of the window with nothing and log a
    // success. LaunchOps never forgets spend it already had, so when the Central holds spend inside
    // the window and the read brings no row at all, the read is broken: stop before touching a day.
    if (adRows.length === 0) {
      const { count: windowCount, error: windowError } = await appDb
        .from('campaign_daily')
        .select('campaign_id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('data', since)
      if (windowError) throw windowError
      if ((windowCount ?? 0) > 0) throw new Error(`LaunchOps returned no ad rows since ${since}; kept the existing campaign days`)
    }
    // Same guard for leads: spend arriving with no lead at all would zero every CPL of the window.
    if (leadRows.length === 0) {
      const { count: leadDays, error: leadError } = await appDb
        .from('campaign_daily')
        .select('campaign_id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('data', since)
        .gt('leads', 0)
      if (leadError) throw leadError
      if ((leadDays ?? 0) > 0) throw new Error(`LaunchOps returned no leads since ${since}; kept the existing campaign days`)
    }
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

    // Fresh numbers, so the watchers judge the last closed day again and open or close alerts (0059).
    const { error: watchError } = await appDb.rpc('evaluate_watchers', { p_client_id: clientId })
    if (watchError) throw watchError

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
