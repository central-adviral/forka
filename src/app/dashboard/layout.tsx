import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')
  const [{ data: testRows }, { data: funnelRows }] = await Promise.all([
    supabase.from('tests').select('client_id'),
    supabase.from('sales_funnels').select('client_id'),
  ])
  const testsCountByClient = new Map<string, number>()
  for (const row of testRows ?? []) testsCountByClient.set(row.client_id, (testsCountByClient.get(row.client_id) ?? 0) + 1)
  const funnelsCountByClient = new Map<string, number>()
  for (const row of funnelRows ?? []) funnelsCountByClient.set(row.client_id, (funnelsCountByClient.get(row.client_id) ?? 0) + 1)

  return (
    <DashboardShell
      clients={(clients ?? []).map((client) => ({
        ...client,
        testsCount: testsCountByClient.get(client.id) ?? 0,
        funnelsCount: funnelsCountByClient.get(client.id) ?? 0,
      }))}
      userEmail={user?.email ?? ''}
    >
      {children}
    </DashboardShell>
  )
}
