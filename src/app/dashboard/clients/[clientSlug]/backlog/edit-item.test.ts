import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Write {
  table: string
  values: Record<string, unknown>
  filters: [string, unknown][]
}

const db = vi.hoisted(() => ({ writes: [] as Write[], abTestId: null as string | null, refused: false }))

function from(table: string) {
  const write: Write = { table, values: {}, filters: [] }
  const builder = {
    update: (values: Record<string, unknown>) => {
      write.values = values
      db.writes.push(write)
      return builder
    },
    eq: (column: string, value: unknown) => {
      write.filters.push([column, value])
      return builder
    },
    select: () => builder,
    then: (resolve: (value: unknown) => void) =>
      resolve(table === 'backlog_items' ? { data: db.refused ? [] : [{ id: 'item-1', ab_test_id: db.abTestId }], error: null } : { data: null, error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ from }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${decodeURIComponent(to)}`)
  },
}))

import { editItem } from './actions'

const context = { client_id: 'c-1', client_slug: 'voe', sales_funnel_id: 'f-1', funnel_slug: 't15', item_id: 'item-1', code: 'T7' }

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe('editItem', () => {
  beforeEach(() => {
    db.writes = []
    db.abTestId = null
    db.refused = false
  })

  it('saves the text fields and renames the variants of a card with no linked test', async () => {
    await expect(editItem(context, form({ title: ' Nova headline ', hypothesis: 'h', metric: 'CPA', owner: '', variant_v1: 'Controle', variant_v2: 'Headline curta' }))).rejects.toThrow(/ok=T7 atualizado/)
    expect(db.writes[0]).toMatchObject({ table: 'backlog_items', values: { title: 'Nova headline', hypothesis: 'h', metric: 'CPA', owner: null } })
    expect(db.writes.slice(1)).toEqual([
      { table: 'backlog_variants', values: { name: 'Controle' }, filters: [['id', 'v1'], ['item_id', 'item-1']] },
      { table: 'backlog_variants', values: { name: 'Headline curta' }, filters: [['id', 'v2'], ['item_id', 'item-1']] },
    ])
  })

  it('keeps the variant names once an A/B test is linked', async () => {
    db.abTestId = 'test-1'
    await expect(editItem(context, form({ title: 'T', variant_v1: 'Outro nome' }))).rejects.toThrow(/ok=/)
    expect(db.writes.map((write) => write.table)).toEqual(['backlog_items'])
  })

  it('refuses an empty variant name before writing anything', async () => {
    await expect(editItem(context, form({ title: 'T', variant_v1: '  ' }))).rejects.toThrow(/erro=nenhuma variante pode ficar sem nome/)
    expect(db.writes).toEqual([])
  })

  it('reports a write the policies refused', async () => {
    db.refused = true
    await expect(editItem(context, form({ title: 'T' }))).rejects.toThrow(/erro=Só gestor ou owner pode editar hipóteses/)
  })
})
