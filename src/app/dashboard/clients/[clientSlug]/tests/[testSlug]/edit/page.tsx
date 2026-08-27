import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { EditTestForm } from './edit-test-form'

export default async function EditTestPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { clientSlug, testSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, fallback_url, clients(slug)')
    .eq('slug', testSlug)
    .maybeSingle()

  const testClientSlug = (test?.clients as unknown as { slug: string } | null)?.slug
  if (!test || testClientSlug !== clientSlug) notFound()

  const { data: variants } = await supabase
    .from('variants')
    .select('id, name, weight_pct, destination_url, thank_you_url')
    .eq('test_id', test.id)
    .order('name')

  return <EditTestForm clientSlug={clientSlug} test={test} variants={variants ?? []} />
}
