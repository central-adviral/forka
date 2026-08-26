import { createServerSupabaseClient } from '@/lib/supabase/server'

interface UsageStats {
  total_clients: number
  total_tests: number
  total_click_events: number
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')
  const { data: usage } = (await supabase.rpc('get_usage_stats').single()) as { data: UsageStats | null }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Clientes</h1>
      {usage && (
        <p className="mb-4 text-xs text-gray-500">
          {usage.total_clients} clientes · {usage.total_tests} testes · {usage.total_click_events} cliques
          registrados (Supabase free tier: 500MB de banco — fique de olho se isso crescer muito rápido)
        </p>
      )}
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
