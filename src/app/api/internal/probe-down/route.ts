import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { probeDownPages } from '@/lib/pages/probe'

// Every 5 minutes: rechecks only the pages whose last check failed, so a page that went down is
// confirmed critical (2 failures in a row) in minutes instead of waiting for the next hourly sync.
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, rechecked: await probeDownPages(createServiceRoleClient()) })
  } catch (err) {
    console.error('[probe-down-failed]', err)
    return NextResponse.json({ ok: false, error: 'probe failed' }, { status: 500 })
  }
}
