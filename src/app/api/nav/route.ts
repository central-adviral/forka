import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadTodayAttention } from '@/lib/repo/today-attention-repo'
import { getProjectSetupStatus } from '@/lib/repo/project-setup-repo'
import { canActAs } from '@/lib/view-as'
import { setupView, type NavCounts } from '@/lib/nav/nav-config'

// The sidebar's badges for the open client, read on the user's own session (so RLS decides what
// they may count). Read-only. The Hoje number comes from the same loader the Hoje screen uses.

export async function GET(request: NextRequest) {
  const clientSlug = request.nextUrl.searchParams.get('client')
  const projectSlug = request.nextUrl.searchParams.get('projeto')
  if (!clientSlug) return NextResponse.json({ error: 'missing client' }, { status: 400 })

  const supabase = await createServerSupabaseClient()
  const { data: client, error: clientError } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (clientError) return NextResponse.json({ error: 'failed to read client' }, { status: 500 })
  if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 })

  try {
    const [today, alerts, backlogRunning, watchers, pages, canConfigure] = await Promise.all([
      loadTodayAttention(supabase, client),
      supabase.from('alerts').select('severity').eq('client_id', client.id).is('closed_at', null),
      supabase.from('backlog_items').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('status', 'running'),
      supabase.from('watchers').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
      supabase.from('pages').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
      canActAs(supabase, client.id, 'analista'),
    ])
    if (alerts.error) throw alerts.error
    if (backlogRunning.error) throw backlogRunning.error
    if (watchers.error) throw watchers.error
    if (pages.error) throw pages.error

    let setup: NavCounts['setup']
    if (canConfigure && projectSlug) {
      const { data: projectRow, error: projectError } = await supabase.from('sales_funnels').select('id').eq('client_id', client.id).eq('slug', projectSlug).maybeSingle()
      if (projectError) throw projectError
      const status = projectRow ? await getProjectSetupStatus(supabase, createServiceRoleClient(), client.id, projectRow.id) : null
      if (status) setup = setupView(status)
    }

    const counts: NavCounts = {
      queue: {
        count: today.attention.length,
        crit: today.attention.filter((item) => item.severity === 'crit').length,
        warn: today.attention.filter((item) => item.severity === 'warn').length,
      },
      openAlerts: { count: alerts.data?.length ?? 0, crit: (alerts.data ?? []).filter((row) => row.severity === 'crit').length },
      testsRunning: backlogRunning.count ?? 0,
      abActive: today.activeTests.length,
      watchers: watchers.count ?? 0,
      pages: pages.count ?? 0,
      setup,
    }
    return NextResponse.json(counts, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[nav-counts-failed]', { clientSlug }, err)
    return NextResponse.json({ error: 'failed to read counts' }, { status: 500 })
  }
}
