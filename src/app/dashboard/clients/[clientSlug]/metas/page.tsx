import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Metas e vigias is per funnel since 0106. The old client-wide address opens the first open funnel's
// screen; the client-wide list of watchers is in Alertas › Vigias.
export default async function MetasRedirect({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('slug')
    .eq('client_id', client.id)
    .is('archived_at', null)
    .order('is_active', { ascending: false })
    .order('name')
    .limit(1)
    .maybeSingle()
  redirect(funnel ? `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/metas` : `/dashboard/clients/${client.slug}/painel#vigias`)
}
