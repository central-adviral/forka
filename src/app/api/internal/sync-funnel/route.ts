import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { listActiveFunnels, type SyncRunResult } from '@/lib/launchops/sync-run'
import { purgeOldClickIps } from '@/lib/repo/redirect-repo'

// The hourly cron. It only fans out: each client is read by its own invocation of
// /api/internal/sync-client, in parallel, so one slow or broken client never eats the time of the
// others and the run no longer grows with the number of clients. It waits for them to report,
// which takes as long as the slowest client, under that route's 240s.
export const maxDuration = 290

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const appDb = createServiceRoleClient()
  let clientIds: string[]
  try {
    clientIds = [...new Set((await listActiveFunnels(appDb)).map((funnel) => funnel.client_id))]
  } catch (err) {
    console.error('[sync-funnel-funnels-failed]', err)
    return NextResponse.json({ ok: false, error: 'failed to list funnels' }, { status: 500 })
  }

  // The cron calls the deployment's own URL, which Deployment Protection puts behind a login page;
  // the production domain is public, so the fan-out goes there.
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : request.nextUrl.origin
  const results = await Promise.allSettled(
    clientIds.map(async (clientId) => {
      const url = new URL('/api/internal/sync-client', origin)
      url.searchParams.set('client', clientId)
      const response = await fetch(url, { headers: { authorization: authHeader }, cache: 'no-store', redirect: 'manual' })
      if (!response.ok) throw new Error(`sync-client ${clientId} answered ${response.status}`)
      return (await response.json()) as SyncRunResult
    })
  )
  const totals = { funnelsProcessed: 0, funnelsFailed: 0, clientsWithCampaigns: 0, clientsFailed: 0 }
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      totals.clientsFailed++
      console.error('[sync-client-dispatch-failed]', { clientId: clientIds[index] }, result.reason)
      return
    }
    totals.funnelsProcessed += result.value.funnelsProcessed
    totals.funnelsFailed += result.value.funnelsFailed
    totals.clientsWithCampaigns += result.value.clientsWithCampaigns
  })

  // Housekeeping rides on the hourly run; a failure here must not fail the sync it follows.
  try {
    await purgeOldClickIps(appDb)
  } catch (err) {
    console.error('[click-ip-purge-failed]', err)
  }

  return NextResponse.json({ ok: true, ...totals })
}
