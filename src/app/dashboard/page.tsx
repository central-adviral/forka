import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SuccessBanner } from '@/components/success-banner'
import Link from 'next/link'

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
    <div className="p-8">
      <Suspense fallback={null}>
        <SuccessBanner param="created" message="Cliente criado com sucesso." />
      </Suspense>
      <h1 className="mb-1 font-['Space_Grotesk'] text-xl font-semibold">Clientes</h1>
      <p className="mb-3 text-sm text-[#8A90A6]">Escolha um cliente na barra lateral para ver os testes.</p>
      {usage && (
        <p className="mb-6 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
          {usage.total_clients} clientes · {usage.total_tests} testes · {usage.total_click_events} cliques
          registrados (Supabase free tier: 500MB de banco — fique de olho se isso crescer muito rápido)
        </p>
      )}
      {(!clients || clients.length === 0) && (
        <Link href="/dashboard/clients/new" className="text-sm font-medium text-[#7C6FF0] hover:text-[#9C90F5]">
          + Criar seu primeiro cliente
        </Link>
      )}
    </div>
  )
}
