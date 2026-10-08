import { cookies } from 'next/headers'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DashboardShell, type ShellProject } from '@/components/dashboard-shell'
import { NAV_RAIL_COOKIE } from '@/lib/nav/nav-config'
import type { ClientRole } from '@/lib/repo/client-access-repo'
import { viewingAsClient } from '@/lib/view-as'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // The sidebar's badges are read per open client by /api/nav, not here for every client.
  const [{ data: clients }, { data: funnelRows }, { data: membershipRows }, { data: staffRow }] = await Promise.all([
    supabase.from('clients').select('id, name, slug').order('name'),
    supabase.from('sales_funnels').select('client_id, name, slug, is_active, status').is('archived_at', null).order('name'),
    supabase.from('memberships').select('client_id, role').eq('user_id', user?.id ?? ''),
    supabase.from('staff').select('role').eq('user_id', user?.id ?? '').maybeSingle(),
  ])
  const projectsByClient = new Map<string, ShellProject[]>()
  for (const row of funnelRows ?? []) {
    projectsByClient.set(row.client_id, [
      ...(projectsByClient.get(row.client_id) ?? []),
      { name: row.name, slug: row.slug, isActive: row.is_active, status: row.status },
    ])
  }
  const roleByClient = new Map<string, ClientRole>((membershipRows ?? []).map((row) => [row.client_id, row.role]))
  const isStaffAdmin = staffRow?.role === 'admin'

  return (
    <DashboardShell
      clients={(clients ?? []).map((client) => ({
        ...client,
        projects: projectsByClient.get(client.id) ?? [],
        // A staff admin without a membership still manages the client, so they get the owner view.
        role: roleByClient.get(client.id) ?? (isStaffAdmin ? 'owner' : 'cliente'),
      }))}
      userEmail={user?.email ?? ''}
      viewAsClient={await viewingAsClient()}
      initialCollapsed={(await cookies()).get(NAV_RAIL_COOKIE)?.value === '1'}
    >
      {children}
    </DashboardShell>
  )
}
