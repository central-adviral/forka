import { NextRequest, NextResponse } from 'next/server'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncOneFunnel } from '@/lib/launchops/sync-funnel'

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
    .select('id, client_id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url, funnel_source_service_role_key)')
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
    await syncOneFunnel(appDb, launchopsDb, funnel)
    funnelsProcessed++
  }

  return NextResponse.json({ ok: true, funnelsProcessed })
}
