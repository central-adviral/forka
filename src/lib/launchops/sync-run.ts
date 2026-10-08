import type { SupabaseClient } from '@supabase/supabase-js'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { syncOneFunnel, syncClientCampaigns } from '@/lib/launchops/sync-funnel'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'
import { probeClientPages } from '@/lib/pages/probe'

export interface FunnelRow {
  id: string
  client_id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
  clients: { funnel_source_url: string | null } | null
}

export interface SyncRunResult {
  funnelsProcessed: number
  funnelsFailed: number
  clientsWithCampaigns: number
}

export async function listActiveFunnels(appDb: SupabaseClient): Promise<FunnelRow[]> {
  const { data, error } = await appDb
    .from('sales_funnels')
    .select('id, client_id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url)')
    // A draft is still being set up and a closed project keeps its numbers frozen (0102).
    .eq('status', 'rodando')
    // An archived project keeps the numbers it had: no sync writes into it any more (0100).
    .is('archived_at', null)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as FunnelRow[]
}

/** Reads LaunchOps for the given funnels: campaigns and the page probe once per client, then each funnel. */
export async function syncFunnels(appDb: SupabaseClient, funnels: FunnelRow[]): Promise<SyncRunResult> {
  let funnelsProcessed = 0
  let funnelsFailed = 0
  const campaignsSyncedFor = new Set<string>()
  for (const funnel of funnels) {
    // One client's broken secret or source must not stop the funnels after it.
    try {
      const sourceUrl = funnel.clients?.funnel_source_url
      if (!sourceUrl) continue
      const { funnelSourceServiceRoleKey } = await getClientSecrets(appDb, funnel.client_id)
      if (!funnelSourceServiceRoleKey) continue
      const launchopsDb = createLaunchOpsClient({ url: sourceUrl, serviceRoleKey: funnelSourceServiceRoleKey })
      // Campaigns belong to the client, not to one funnel: one read per client per run. They go first
      // because the creative spend of a project with fronts picks its ads from them.
      if (!campaignsSyncedFor.has(funnel.client_id)) {
        campaignsSyncedFor.add(funnel.client_id)
        await syncClientCampaigns(appDb, launchopsDb, funnel.client_id)
        // The page probe (0066) rides on the same run; a failure here must not stop the sync.
        try {
          await probeClientPages(appDb, funnel.client_id)
        } catch (err) {
          console.error('[page-probe-failed]', { clientId: funnel.client_id }, err)
        }
      }
      await syncOneFunnel(appDb, launchopsDb, funnel)
      funnelsProcessed++
    } catch (err) {
      funnelsFailed++
      console.error('[sync-funnel-client-failed]', { salesFunnelId: funnel.id, clientId: funnel.client_id }, err)
    }
  }
  return { funnelsProcessed, funnelsFailed, clientsWithCampaigns: campaignsSyncedFor.size }
}
