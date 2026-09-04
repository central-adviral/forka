import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForFunnel } from '@/lib/launchops/sync-sales'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  syncAdSpendForFunnel,
} from '@/lib/launchops/sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForFunnel,
} from '@/lib/launchops/sync-ad-creative-spend'

interface FunnelRow {
  id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
  clients: { funnel_source_url: string | null; funnel_source_service_role_key: string | null } | null
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const appDb = createServiceRoleClient()

  const { data: funnels, error: funnelsError } = await appDb
    .from('sales_funnels')
    .select('id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url, funnel_source_service_role_key)')
    .eq('is_active', true)
  if (funnelsError) {
    console.error('[sync-funnel-funnels-failed]', funnelsError)
    return NextResponse.json({ ok: false, error: 'failed to list funnels' }, { status: 500 })
  }

  let funnelsProcessed = 0
  for (const funnel of (funnels ?? []) as unknown as FunnelRow[]) {
    const source = funnel.clients
    if (!source?.funnel_source_url || !source?.funnel_source_service_role_key) continue
    const launchopsDb = createLaunchOpsClient({ url: source.funnel_source_url, serviceRoleKey: source.funnel_source_service_role_key })
    await syncSalesEntity(appDb, launchopsDb, funnel)
    await syncAdSpendEntity(appDb, launchopsDb, funnel)
    await syncAdCreativeSpendEntity(appDb, launchopsDb, funnel)
    funnelsProcessed++
  }

  return NextResponse.json({ ok: true, funnelsProcessed })
}

async function syncSalesEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
  if (!funnel.launchops_produto_nomes?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'sales')
    const rows = await fetchLaunchOpsSalesRows(launchopsDb, { produtoNomes: funnel.launchops_produto_nomes, since: cursor })
    const { latestUpdatedAt } = await syncSalesForFunnel(appDb, funnel.id, rows)
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'ok', newCursor: latestUpdatedAt ?? undefined })
  } catch (err) {
    console.error('[sync-funnel-sales-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-sales-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

async function syncAdSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
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
      await syncAdSpendForFunnel(appDb, funnel.id, aggregated)
    }
    const latestUpdatedAt = rawRows.length > 0 ? rawRows[rawRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-spend-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
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
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_creative_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-creative-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}
