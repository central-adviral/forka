import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Clientes</h1>
      <ul className="space-y-2">
        {clients?.map((client) => (
          <li key={client.id}>
            <a href={`/dashboard/clients/${client.slug}`} className="text-blue-600 underline">
              {client.name}
            </a>
          </li>
        ))}
      </ul>
      <a href="/dashboard/clients/new" className="mt-4 inline-block text-sm text-blue-600 underline">
        + Novo cliente
      </a>
    </div>
  )
}
