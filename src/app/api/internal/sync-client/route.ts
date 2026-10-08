import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { listActiveFunnels, syncFunnels } from '@/lib/launchops/sync-run'

// One client per invocation, so every client gets its own time budget. Under LEASE_SECONDS
// (sync-campaigns.ts), so a run the platform kills never outlives its lease.
export const maxDuration = 240

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const clientId = request.nextUrl.searchParams.get('client')
  if (!clientId) return NextResponse.json({ ok: false, error: 'missing client' }, { status: 400 })

  const appDb = createServiceRoleClient()
  let funnels
  try {
    funnels = (await listActiveFunnels(appDb)).filter((funnel) => funnel.client_id === clientId)
  } catch (err) {
    console.error('[sync-client-funnels-failed]', { clientId }, err)
    return NextResponse.json({ ok: false, error: 'failed to list funnels' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...(await syncFunnels(appDb, funnels)) })
}
