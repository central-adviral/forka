import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function ClientPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, name, slug, status')
    .eq('client_id', client.id)
    .order('name')

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{client.name}</h1>
      <ul className="space-y-2">
        {tests?.map((test) => (
          <li key={test.id}>
            <a href={`/dashboard/clients/${client.slug}/tests/${test.slug}`} className="text-blue-600 underline">
              {test.name} ({test.status})
            </a>
          </li>
        ))}
      </ul>
      <a href={`/dashboard/clients/${client.slug}/tests/new`} className="mt-4 inline-block text-sm text-blue-600 underline">
        + Novo teste
      </a>
    </div>
  )
}
