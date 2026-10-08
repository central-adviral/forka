import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  ops: [] as string[],
  current: { kind: 'include', value: '[GER]' } as { kind: string; value: string } | null,
  insertError: null as { code: string; message: string } | null,
}))

function from() {
  let op = 'select'
  const builder = {
    select: () => builder,
    eq: () => builder,
    insert: (values: { kind: string; value: string }) => {
      op = `insert ${values.kind} ${values.value}`
      db.ops.push(op)
      return builder
    },
    delete: () => {
      op = 'delete'
      db.ops.push(op)
      return builder
    },
    maybeSingle: async () => ({ data: db.current, error: null }),
    then: (resolve: (value: unknown) => void) =>
      resolve(op.startsWith('insert') ? { data: db.insertError ? null : [{ id: 'new' }], error: db.insertError } : { data: null, error: null }),
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

import { updateRule } from './actions'

const context = { client_slug: 'voe', funnel_slug: 't15', sales_funnel_id: 'f-1', front_id: 'front-1', rule_id: 'rule-1' }

function form(kind: string, value: string): FormData {
  const data = new FormData()
  data.set('kind', kind)
  data.set('value', value)
  return data
}

describe('updateRule', () => {
  beforeEach(() => {
    db.ops = []
    db.current = { kind: 'include', value: '[GER]' }
    db.insertError = null
  })

  it('adds the new rule before removing the old one, and offers Aplicar desde', async () => {
    await expect(updateRule(context, form('include', '[GER2]'))).rejects.toThrow(/ok=Regra alterada.*&mudou=1/)
    expect(db.ops).toEqual(['insert include [GER2]', 'delete'])
  })

  it('keeps the old rule when the new one is refused', async () => {
    db.insertError = { code: '23505', message: 'duplicate' }
    await expect(updateRule(context, form('exclude', '[GER]'))).rejects.toThrow(/erro=Essa regra já existe nesta frente/)
    expect(db.ops).toEqual(['insert exclude [GER]'])
  })

  it('writes nothing when the rule did not change', async () => {
    await expect(updateRule(context, form('include', ' [GER] '))).rejects.toThrow(/ok=Nada mudou/)
    expect(db.ops).toEqual([])
  })
})
