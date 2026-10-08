import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { EditTestForm } from './edit-test-form'
import { canActAs } from '@/lib/view-as'

export default async function EditTestPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { clientSlug, testSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, client_id, archived_at, fallback_url, test_type, sales_page_url, sales_funnel_id, clients(slug)')
    .eq('slug', testSlug)
    .maybeSingle()

  const testClientSlug = (test?.clients as unknown as { slug: string } | null)?.slug
  if (!test || testClientSlug !== clientSlug) notFound()
  if (test.archived_at || !(await canActAs(supabase, test.client_id, 'gestor'))) notFound()

  const [{ data: variants }, { data: funnels }] = await Promise.all([
    supabase.from('variants').select('id, name, weight_pct, destination_url, thank_you_url').eq('test_id', test.id).order('name'),
    supabase.from('sales_funnels').select('id, name').eq('client_id', test.client_id).order('name'),
  ])

  return <EditTestForm clientSlug={clientSlug} test={test} funnels={funnels ?? []} variants={variants ?? []} />
}
