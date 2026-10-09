import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ archivedAt: '2026-10-01T12:00:00Z' as string | null, writes: [] as string[] }))

function from(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    is: () => builder,
    in: () => builder,
    maybeSingle: async () => ({ data: table === 'sales_funnels' ? { archived_at: db.archivedAt } : null, error: null }),
    update: () => {
      db.writes.push(`update ${table}`)
      return builder
    },
    upsert: () => {
      db.writes.push(`upsert ${table}`)
      return builder
    },
    delete: () => {
      db.writes.push(`delete ${table}`)
      return builder
    },
    then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'x', produto_nome: 'x' }], error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from,
    rpc: async (name: string) => {
      db.writes.push(`rpc ${name}`)
      return { data: [{}], error: null }
    },
  }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${decodeURIComponent(to)}`)
  },
}))

import { saveBand, saveResult } from './[funnelSlug]/metas/actions'
import { removeProduct, setProductRole } from './[funnelSlug]/produtos/actions'
import { applySince } from './[funnelSlug]/apply-since-actions'
import { editSalesFunnel } from './actions'

const funnelId = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const context = { client_id: clientId, client_slug: 'voe', funnel_slug: 't15', sales_funnel_id: funnelId }

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('writes to an archived project', () => {
  beforeEach(() => {
    db.archivedAt = '2026-10-01T12:00:00Z'
    db.writes = []
  })

  it('refuses the result, its meta and the faixa padrão', async () => {
    await expect(saveResult(context, form({ resultado: 'compra' }))).rejects.toThrow(/erro=Funil arquivado: restaure para editar/)
    await expect(saveBand(context, form({ warn_pct: '20', crit_pct: '40' }))).rejects.toThrow(/erro=Funil arquivado: restaure para editar/)
    expect(db.writes).toEqual([])
  })

  it('refuses adding, changing and removing products', async () => {
    await expect(setProductRole(context, form({ produto_nome: 'Curso', papel: 'entrada' }))).rejects.toThrow(/erro=Funil arquivado/)
    await expect(removeProduct({ ...context, produto_nome: 'Curso' })).rejects.toThrow(/erro=Funil arquivado/)
    expect(db.writes).toEqual([])
  })

  it('refuses Aplicar desde', async () => {
    await expect(applySince({ sales_funnel_id: funnelId, path: '/p' }, form({ since: '2026-09-01' }))).rejects.toThrow(/erro=Funil arquivado/)
    expect(db.writes).toEqual([])
  })

  it('refuses the project edit', async () => {
    const edit = form({ name: 'T15', launchops_operacao_ids: '', starts_on: '', ends_on: '' })
    await expect(editSalesFunnel(context, edit)).rejects.toThrow('Funil arquivado: restaure para editar.')
    expect(db.writes).toEqual([])
  })

  it('lets an active project change its products', async () => {
    db.archivedAt = null
    await expect(setProductRole(context, form({ produto_nome: 'Curso', papel: 'entrada' }))).rejects.toThrow(/ok=Curso salvo/)
    expect(db.writes).toEqual(['upsert project_products'])
  })
})
