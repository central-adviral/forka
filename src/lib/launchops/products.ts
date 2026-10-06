import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

export interface LaunchOpsProduct {
  produto_nome: string
  plataformas: string[]
  vendas: number
  ticket: number
}

interface ProductSaleRow {
  produto_nome: string | null
  plataforma: string | null
  valor_bruto: number | string | null
}

/** Approved sales per product in LaunchOps over the last days, the list the gestor classifies from. */
export async function fetchLaunchOpsProducts(launchopsDb: SupabaseClient, lookbackDays: number): Promise<LaunchOpsProduct[]> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString()
  const rows = await fetchAllPages<ProductSaleRow>((from, to) =>
    launchopsDb
      .from('vendas')
      .select('produto_nome, plataforma, valor_bruto')
      .eq('status', 'aprovada')
      .gte('data_venda', since)
      .order('id', { ascending: true })
      .range(from, to)
  )
  return summarizeProducts(rows)
}

export function summarizeProducts(rows: ProductSaleRow[]): LaunchOpsProduct[] {
  const byName = new Map<string, { plataformas: Set<string>; vendas: number; total: number }>()
  for (const row of rows) {
    if (!row.produto_nome) continue
    const current = byName.get(row.produto_nome) ?? { plataformas: new Set<string>(), vendas: 0, total: 0 }
    if (row.plataforma) current.plataformas.add(row.plataforma)
    current.vendas += 1
    current.total += Number(row.valor_bruto ?? 0)
    byName.set(row.produto_nome, current)
  }
  return [...byName.entries()]
    .map(([produto_nome, value]) => ({
      produto_nome,
      plataformas: [...value.plataformas].sort(),
      vendas: value.vendas,
      ticket: value.total / value.vendas,
    }))
    .sort((a, b) => b.vendas - a.vendas)
}
