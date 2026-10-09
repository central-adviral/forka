import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Call {
  table: string
  op: 'select' | 'update' | 'insert' | 'delete'
  values?: Record<string, unknown>
  filters: [string, unknown][]
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  stageUpdates: [] as [string, Record<string, unknown>][],
  plan: { principal: { id: 'w-p' } as { id: string } | null, secundaria: null as { id: string } | null },
  stages: [] as { id: string; measure: string; position: number; parallel: boolean; archivedAt: string | null; meta: number | null; metaRoas: number | null }[],
  resultado: 'compra',
}))

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  db.calls.push(call)
  const builder = {
    select: () => builder,
    is: () => builder,
    update: (values: Record<string, unknown>) => Object.assign(call, { op: 'update', values }) && builder,
    insert: (values: Record<string, unknown>) => Object.assign(call, { op: 'insert', values }) && builder,
    delete: () => Object.assign(call, { op: 'delete' }) && builder,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value])
      return builder
    },
    maybeSingle: async () => {
      if (table === 'sales_funnels') return { data: { archived_at: null, resultado: db.resultado }, error: null }
      const role = call.filters.find(([column]) => column === 'plan_role')?.[1] as 'principal' | 'secundaria'
      return { data: db.plan[role], error: null }
    },
    then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'x' }], error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ from }) }))
vi.mock('@/lib/repo/funnel-stages-repo', () => ({
  getFunnelStages: async () => db.stages,
  updateStage: async (_db: unknown, id: string, values: Record<string, unknown>) => {
    db.stageUpdates.push([id, values])
  },
  updateCostCombo: async () => undefined,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${decodeURIComponent(to)}`)
  },
}))

import { saveBand, saveResult } from './actions'

const context = { client_id: 'c-1', client_slug: 'voe', funnel_slug: 't15', sales_funnel_id: 'f-1' }
function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}
const watcherWrites = () => db.calls.filter((call) => call.table === 'watchers' && call.op !== 'select')

describe('Resultado do funil: the result is the last sequence stage and its meta is the stage meta', () => {
  beforeEach(() => {
    db.calls = []
    db.stageUpdates = []
    db.plan = { principal: { id: 'w-p' }, secundaria: null }
    db.resultado = 'compra'
    db.stages = [
      { id: 'cap', measure: 'lead', position: 0, parallel: false, archivedAt: null, meta: 6, metaRoas: null },
      { id: 'vnd', measure: 'compra', position: 1, parallel: false, archivedAt: null, meta: 55, metaRoas: null },
    ]
  })

  it('keeps the result watcher following the stage, and writes the secondary ROAS on the compra stage', async () => {
    await expect(saveResult(context, form({ julgar: 'compra', min_spend: '300', metrica_secundaria: 'roas', secondary_target: '2,5' }))).rejects.toThrow(/ok=Resultado salvo/)
    expect(db.stageUpdates).toEqual([['vnd', { metaRoas: 2.5 }]])
    expect(db.calls.find((call) => call.table === 'sales_funnels' && call.op === 'update')?.values).toMatchObject({ resultado: 'compra', metrica_secundaria: 'roas' })
    const [principal, secondary] = watcherWrites()
    expect(principal).toMatchObject({ op: 'update', values: { metric: 'cpa_geral', target: null, min_spend: 300 }, filters: [['id', 'w-p']] })
    expect(secondary).toMatchObject({ op: 'insert', values: { metric: 'roas', target: null, plan_role: 'secundaria', is_plan: false } })
  })

  it('judges a compra result stage by ROAS or checkout; checkout keeps its meta on the watcher', async () => {
    await expect(saveResult(context, form({ julgar: 'checkout', cost_target: '12' }))).rejects.toThrow(/ok=/)
    expect(db.stageUpdates).toEqual([])
    expect(watcherWrites()[0]).toMatchObject({ op: 'update', values: { metric: 'custo_checkout', target: 12 } })
  })

  it('never moves the result off the stages: with a lead result stage the choice is ignored', async () => {
    db.resultado = 'lead'
    db.stages = [db.stages[0]]
    await expect(saveResult(context, form({ julgar: 'roas' }))).rejects.toThrow(/ok=/)
    expect(db.calls.find((call) => call.table === 'sales_funnels' && call.op === 'update')?.values).toMatchObject({ resultado: 'lead' })
    expect(watcherWrites()[0]).toMatchObject({ op: 'update', values: { metric: 'cpl', target: null } })
  })

  it('a result stage without meta: no result watcher, as before', async () => {
    db.stages = [db.stages[0], { ...db.stages[1], meta: null }]
    await expect(saveResult(context, form({ julgar: 'compra' }))).rejects.toThrow(/ok=/)
    expect(watcherWrites()).toMatchObject([{ op: 'delete', filters: [['id', 'w-p']] }])
  })

  it('refuses a faixa padrão where crítico comes before atenção', async () => {
    await expect(saveBand(context, form({ warn_pct: '40', crit_pct: '20' }))).rejects.toThrow(/erro=o crítico precisa ser maior/)
  })
})
