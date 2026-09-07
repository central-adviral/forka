import { NextRequest, NextResponse } from 'next/server'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncOneFunnel } from '@/lib/launchops/sync-funnel'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'

interface FunnelRow {
  id: string
  client_id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
  clients: { funnel_source_url: string | null } | null
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
    .select('id, client_id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url)')
    .eq('is_active', true)
  if (funnelsError) {
    console.error('[sync-funnel-funnels-failed]', funnelsError)
    return NextResponse.json({ ok: false, error: 'failed to list funnels' }, { status: 500 })
  }

  let funnelsProcessed = 0
  for (const funnel of (funnels ?? []) as unknown as FunnelRow[]) {
    const sourceUrl = funnel.clients?.funnel_source_url
    if (!sourceUrl) continue
    const { funnelSourceServiceRoleKey } = await getClientSecrets(appDb, funnel.client_id)
    if (!funnelSourceServiceRoleKey) continue
    const launchopsDb = createLaunchOpsClient({ url: sourceUrl, serviceRoleKey: funnelSourceServiceRoleKey })
    await syncOneFunnel(appDb, launchopsDb, funnel)
    funnelsProcessed++
  }

  return NextResponse.json({ ok: true, funnelsProcessed })
}
