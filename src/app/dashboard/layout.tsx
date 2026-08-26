import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')

  return (
    <DashboardShell clients={clients ?? []} userEmail={user?.email ?? ''}>
      {children}
    </DashboardShell>
  )
}
