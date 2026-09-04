import type { SupabaseClient } from '@supabase/supabase-js'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForFunnel } from './sync-sales'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  fetchLaunchOpsInitiateCheckoutByOperacaoDay,
  syncAdSpendForFunnel,
} from './sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForFunnel,
} from './sync-ad-creative-spend'

export interface SyncableFunnel {
  id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
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

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: SyncableFunnel) {
  if (!funnel.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'ad_creative_spend_daily')
    const creatives = await fetchLaunchOpsAdCreatives(launchopsDb, funnel.launchops_operacao_ids)
    const spendRows = await fetchLaunchOpsAdCreativeSpendRows(launchopsDb, { anuncioIds: creatives.map((c) => c.id), since: cursor })
    const joined = joinAdCreativeSpend(creatives, spendRows)
    await syncAdCreativeSpendForFunnel(appDb, funnel.id, joined)
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
