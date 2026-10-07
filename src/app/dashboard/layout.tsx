import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DashboardShell, type ShellProject } from '@/components/dashboard-shell'
import type { ClientRole } from '@/lib/repo/client-access-repo'
import { viewingAsClient } from '@/lib/view-as'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [{ data: clients }, { data: testRows }, { data: funnelRows }, { data: membershipRows }, { data: staffRow }, { data: alertRows }] =
    await Promise.all([
      supabase.from('clients').select('id, name, slug').order('name'),
      supabase.from('tests').select('client_id'),
      supabase.from('sales_funnels').select('client_id, name, slug, is_active').order('name'),
      supabase.from('memberships').select('client_id, role').eq('user_id', user?.id ?? ''),
      supabase.from('staff').select('role').eq('user_id', user?.id ?? '').maybeSingle(),
      supabase.from('alerts').select('client_id').is('closed_at', null),
    ])
  const openAlertsByClient = new Map<string, number>()
  for (const row of alertRows ?? []) openAlertsByClient.set(row.client_id, (openAlertsByClient.get(row.client_id) ?? 0) + 1)
  const testsCountByClient = new Map<string, number>()
  for (const row of testRows ?? []) testsCountByClient.set(row.client_id, (testsCountByClient.get(row.client_id) ?? 0) + 1)
  const projectsByClient = new Map<string, ShellProject[]>()
  for (const row of funnelRows ?? []) {
    projectsByClient.set(row.client_id, [
      ...(projectsByClient.get(row.client_id) ?? []),
      { name: row.name, slug: row.slug, isActive: row.is_active },
    ])
  }
  const roleByClient = new Map<string, ClientRole>((membershipRows ?? []).map((row) => [row.client_id, row.role]))
  const isStaffAdmin = staffRow?.role === 'admin'

  return (
    <DashboardShell
      clients={(clients ?? []).map((client) => ({
        ...client,
        testsCount: testsCountByClient.get(client.id) ?? 0,
        openAlerts: openAlertsByClient.get(client.id) ?? 0,
        projects: projectsByClient.get(client.id) ?? [],
        // A staff admin without a membership still manages the client, so they get the owner view.
        role: roleByClient.get(client.id) ?? (isStaffAdmin ? 'owner' : 'cliente'),
      }))}
      userEmail={user?.email ?? ''}
      viewAsClient={await viewingAsClient()}
    >
      {children}
    </DashboardShell>
  )
}
