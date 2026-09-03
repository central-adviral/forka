import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForClient } from '@/lib/launchops/sync-sales'
import { fetchLaunchOpsAdSpendRows, aggregateAdSpendByOperacaoDay, syncAdSpendForClient } from '@/lib/launchops/sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForClient,
} from '@/lib/launchops/sync-ad-creative-spend'

interface FunnelClient {
  id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const appDb = createServiceRoleClient()
  const launchopsDb = createLaunchOpsClient()

  const { data: clients, error: clientsError } = await appDb
    .from('clients')
    .select('id, launchops_operacao_ids, launchops_produto_nomes')
    .not('launchops_operacao_ids', 'is', null)
  if (clientsError) {
    console.error('[sync-funnel-clients-failed]', clientsError)
    return NextResponse.json({ ok: false, error: 'failed to list clients' }, { status: 500 })
  }

  for (const client of (clients ?? []) as FunnelClient[]) {
    await syncSalesEntity(appDb, launchopsDb, client)
    await syncAdSpendEntity(appDb, launchopsDb, client)
    await syncAdCreativeSpendEntity(appDb, launchopsDb, client)
  }

  return NextResponse.json({ ok: true, clientsProcessed: (clients ?? []).length })
}

async function syncSalesEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_produto_nomes?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'sales')
    const rows = await fetchLaunchOpsSalesRows(launchopsDb, { produtoNomes: client.launchops_produto_nomes, since: cursor })
    const { latestUpdatedAt } = await syncSalesForClient(appDb, client.id, rows)
    await recordSyncResult(appDb, { clientId: client.id, entity: 'sales', result: 'ok', newCursor: latestUpdatedAt ?? undefined })
  } catch (err) {
    console.error('[sync-funnel-sales-failed]', { clientId: client.id }, err)
    try {
      await recordSyncResult(appDb, { clientId: client.id, entity: 'sales', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-sales-record-failed]', { clientId: client.id }, recordErr)
    }
  }
}

async function syncAdSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'ad_spend_daily')
    const rawRows = await fetchLaunchOpsAdSpendRows(launchopsDb, { operacaoIds: client.launchops_operacao_ids, since: cursor })
    const aggregated = aggregateAdSpendByOperacaoDay(rawRows)
    await syncAdSpendForClient(appDb, client.id, aggregated)
    const latestUpdatedAt = rawRows.length > 0 ? rawRows[rawRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-spend-failed]', { clientId: client.id }, err)
    try {
      await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-spend-record-failed]', { clientId: client.id }, recordErr)
    }
  }
}

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'ad_creative_spend_daily')
    const creatives = await fetchLaunchOpsAdCreatives(launchopsDb, client.launchops_operacao_ids)
    const spendRows = await fetchLaunchOpsAdCreativeSpendRows(launchopsDb, { anuncioIds: creatives.map((c) => c.id), since: cursor })
    const joined = joinAdCreativeSpend(creatives, spendRows)
    await syncAdCreativeSpendForClient(appDb, client.id, joined)
    const latestUpdatedAt = spendRows.length > 0 ? spendRows[spendRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_creative_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-creative-spend-failed]', { clientId: client.id }, err)
    try {
      await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_creative_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-creative-spend-record-failed]', { clientId: client.id }, recordErr)
    }
  }
}
