import type { SupabaseClient } from '@supabase/supabase-js'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForFunnel, reconcileUnmatchedSales } from './sync-sales'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  fetchLaunchOpsInitiateCheckoutByOperacaoDay,
  syncAdSpendForFunnel,
} from './sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativesByAdIds,
  fetchLaunchOpsAdCreativesByCampaignIds,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForFunnel,
} from './sync-ad-creative-spend'
import { syncCampaignsForClient } from './sync-campaigns'

export interface SyncableFunnel {
  id: string
  client_id?: string | null
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
}

// Ad ids this client's own tests actually received traffic from. Used to widen the creative
// fetch beyond the mapped operation, so an unclassified ad still gets its spend synced.
async function adIdsSeenInClicks(appDb: SupabaseClient, clientId: string): Promise<string[]> {
  const { data: tests, error: testsError } = await appDb.from('tests').select('id').eq('client_id', clientId)
  if (testsError) throw testsError
  const testIds = (tests ?? []).map((t) => t.id)
  if (testIds.length === 0) return []

  const { data, error } = await appDb
    .from('click_events')
    .select('source_utms')
    .in('test_id', testIds)
    .not('source_utms->>fb_ad_id', 'is', null)
  if (error) throw error

  const ids = new Set<string>()
  for (const row of data ?? []) {
    const adId = (row.source_utms as Record<string, string> | null)?.fb_ad_id
    if (adId) ids.add(adId)
  }
  return [...ids]
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

// A failure here is logged and swallowed like the per-entity syncs below: one bad read must not
// stop the next client's sync, and the freshness of campaign_daily.synced_at shows it went stale.
export async function syncClientCampaigns(appDb: SupabaseClient, launchopsDb: SupabaseClient, clientId: string) {
  try {
    const result = await syncCampaignsForClient(appDb, launchopsDb, clientId)
    console.log('[sync-client-campaigns]', { clientId, ...result })
  } catch (err) {
    console.error('[sync-client-campaigns-failed]', { clientId }, err)
  }
}

export async function syncOneFunnel(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: SyncableFunnel) {
  await syncSalesEntity(appDb, launchopsDb, funnel)
  await syncAdSpendEntity(appDb, launchopsDb, funnel)
  await syncAdCreativeSpendEntity(appDb, launchopsDb, funnel)
}

async function syncSalesEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: SyncableFunnel) {
  if (!funnel.launchops_produto_nomes?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'sales')
    const rows = await fetchLaunchOpsSalesRows(launchopsDb, { produtoNomes: funnel.launchops_produto_nomes, since: cursor })
    const { latestUpdatedAt } = await syncSalesForFunnel(appDb, funnel.id, rows)
    const { reconciled } = await reconcileUnmatchedSales(appDb, funnel.id)
    if (reconciled > 0) console.log('[sync-funnel-sales-reconciled]', { salesFunnelId: funnel.id, reconciled })
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'ok', newCursor: latestUpdatedAt ?? undefined })
  } catch (err) {
    console.error('[sync-funnel-sales-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'error', message: errorMessage(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-sales-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

async function syncAdSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: SyncableFunnel) {
  if (!funnel.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'ad_spend_daily')
    const rawRows = await fetchLaunchOpsAdSpendRows(launchopsDb, { operacaoIds: funnel.launchops_operacao_ids, since: cursor })
    if (rawRows.length > 0) {
      const days = [...new Set(rawRows.map((row) => row.data_referencia))]
      const fullDayRows = await fetchLaunchOpsAdSpendRowsForDays(launchopsDb, {
        operacaoIds: funnel.launchops_operacao_ids,
        days,
      })
      const aggregated = aggregateAdSpendByOperacaoDay(fullDayRows)
      const initiateCheckoutRows = await fetchLaunchOpsInitiateCheckoutByOperacaoDay(launchopsDb, {
        operacaoIds: funnel.launchops_operacao_ids,
        days,
      })
      const initiateCheckoutByKey = new Map(
        initiateCheckoutRows.map((row) => [`${row.operacao_id}|${row.data}`, row.initiateCheckout])
      )
      const merged = aggregated.map((row) => ({
        ...row,
        initiateCheckout: initiateCheckoutByKey.get(`${row.operacao_id}|${row.data}`) ?? 0,
      }))
      await syncAdSpendForFunnel(appDb, funnel.id, merged)
    }
    const latestUpdatedAt = rawRows.length > 0 ? rawRows[rawRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-spend-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'error', message: errorMessage(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

// Campaigns owned by this project's own fronts (not the ones reading another project), or null when
// the project has no fronts and still relies on the LaunchOps operation mapping.
async function projectCampaignIds(appDb: SupabaseClient, funnel: SyncableFunnel): Promise<string[] | null> {
  if (!funnel.client_id) return null
  const { data: fronts, error } = await appDb
    .from('project_fronts')
    .select('id')
    .eq('sales_funnel_id', funnel.id)
    .is('source_sales_funnel_id', null)
  if (error) throw error
  if (!fronts?.length) return null
  const frontIds = new Set(fronts.map((front) => front.id as string))
  const { data: campaigns, error: campaignsError } = await appDb.rpc('get_client_campaigns', {
    p_client_id: funnel.client_id,
    p_since: '2000-01-01',
    p_until: '2100-01-01',
  })
  if (campaignsError) throw campaignsError
  return ((campaigns ?? []) as { campaign_id: string; front_ids: string[] }[])
    .filter((campaign) => (campaign.front_ids ?? []).some((id) => frontIds.has(id)))
    .map((campaign) => campaign.campaign_id)
}

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: SyncableFunnel) {
  try {
    const campaignIds = await projectCampaignIds(appDb, funnel)
    if (!campaignIds && !funnel.launchops_operacao_ids?.length) return
    const cursor = await getSyncCursor(appDb, funnel.id, 'ad_creative_spend_daily')
    // LaunchOps stopped tagging operations (2026-09-23), so a project with fronts takes its ads from
    // the campaigns its fronts own. That set changes with the rules, and a campaign joining a front
    // must bring its whole history, so the fronts path re-reads everything instead of using a cursor.
    // bsheep: full re-read per sync is ~6k rows today; move to a per-campaign cursor if anuncio_dia grows large
    const byScope = campaignIds
      ? await fetchLaunchOpsAdCreativesByCampaignIds(launchopsDb, campaignIds)
      : await fetchLaunchOpsAdCreatives(launchopsDb, funnel.launchops_operacao_ids!)
    // The clicked-ads widening only patches the operation mapping; with fronts it would pull in ads
    // of campaigns the project does not own and inflate its creative spend.
    const seenAdIds = !campaignIds && funnel.client_id ? await adIdsSeenInClicks(appDb, funnel.client_id) : []
    const byClickedAdId = await fetchLaunchOpsAdCreativesByAdIds(launchopsDb, seenAdIds)
    const creatives = [...new Map([...byScope, ...byClickedAdId].map((c) => [c.id, c])).values()]
    const spendRows = await fetchLaunchOpsAdCreativeSpendRows(launchopsDb, {
      anuncioIds: creatives.map((c) => c.id),
      since: campaignIds ? null : cursor,
    })
    const joined = joinAdCreativeSpend(creatives, spendRows)
    const rewriteStartedAt = new Date().toISOString()
    await syncAdCreativeSpendForFunnel(appDb, funnel.id, joined)
    // A full re-read rewrote every row the project still owns; whatever it did not touch is a renamed
    // ad's old name or a campaign that left the fronts. An empty read keeps everything.
    if (campaignIds && joined.length > 0) {
      const { error: pruneError } = await appDb
        .from('ad_creative_spend_daily')
        .delete()
        .eq('sales_funnel_id', funnel.id)
        .lt('updated_at', rewriteStartedAt)
      if (pruneError) throw pruneError
    }
    const latestUpdatedAt = spendRows.length > 0 ? spendRows[spendRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_creative_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-creative-spend-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_creative_spend_daily', result: 'error', message: errorMessage(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-creative-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}
