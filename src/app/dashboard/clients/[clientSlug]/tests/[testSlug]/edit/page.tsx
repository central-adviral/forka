import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { EditTestForm } from './edit-test-form'
import { canActAs } from '@/lib/view-as'
import { RoutesEditor } from './routes-editor'
import type { VariantRoute } from '@/lib/domain/routing'

type VariantFormRow = { id: string; name: string; weight_pct: number; destination_url: string; thank_you_url: string | null }

export default async function EditTestPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const { clientSlug, testSlug } = await params
  const { erro } = await searchParams
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
    supabase.from('variants').select('id, name, weight_pct, destination_url, thank_you_url, variant_routes(id, match_field, match_value, destination_url, position)').eq('test_id', test.id).order('name'),
    // An archived project is no choice, unless the test already points at it.
    supabase
      .from('sales_funnels')
      .select('id, name')
      .eq('client_id', test.client_id)
      .or(test.sales_funnel_id ? `archived_at.is.null,id.eq.${test.sales_funnel_id}` : 'archived_at.is.null')
      .order('name'),
  ])

  const rows = (variants ?? []) as unknown as (VariantFormRow & { variant_routes: (VariantRoute & { position: number })[] })[]
  return (
    <>
      <EditTestForm clientSlug={clientSlug} test={test} funnels={funnels ?? []} variants={rows.map((row) => ({ id: row.id, name: row.name, weight_pct: row.weight_pct, destination_url: row.destination_url, thank_you_url: row.thank_you_url }))} />
      {test.test_type === 'page' && <RoutesEditor clientSlug={clientSlug} testSlug={test.slug} testId={test.id} variants={rows} error={erro} />}
    </>
  )
}
