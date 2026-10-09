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
  stages: [] as { id: string; measure: string; position: number; archivedAt: string | null; meta: number | null; metaRoas: number | null }[],
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
      if (table === 'sales_funnels') return { data: { archived_at: null }, error: null }
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
vi.mock('@/lib/repo/result-meta-repo', () => ({ ensureResultWatchers: async () => undefined }))
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

describe('Resultado do funil: its meta is the meta of the stage that measures it', () => {
  beforeEach(() => {
    db.calls = []
    db.stageUpdates = []
    db.plan = { principal: { id: 'w-p' }, secundaria: null }
    db.stages = [
      { id: 'cap', measure: 'lead', position: 0, archivedAt: null, meta: 6, metaRoas: null },
      { id: 'vnd', measure: 'compra', position: 1, archivedAt: null, meta: 55, metaRoas: null },
    ]
  })

  it('writes the CPA meta on the compra stage and makes the result watcher follow it', async () => {
    await expect(saveResult(context, form({ resultado: 'compra', cost_target: '48,50', metrica_secundaria: 'roas', secondary_target: '2,5' }))).rejects.toThrow(/ok=Resultado e meta salvos/)
    expect(db.stageUpdates).toEqual([
      ['vnd', { meta: 48.5 }],
      ['vnd', { metaRoas: 2.5 }],
    ])
    const [principal, secondary] = watcherWrites()
    expect(principal).toMatchObject({ op: 'update', values: { metric: 'cpa_geral', target: null, min_spend: 0 }, filters: [['id', 'w-p']] })
    expect(secondary).toMatchObject({ op: 'insert', values: { metric: 'roas', target: null, plan_role: 'secundaria', is_plan: false } })
  })

  it('keeps a result no stage measures as a specific meta on its watcher', async () => {
    await expect(saveResult(context, form({ resultado: 'checkout', cost_target: '12' }))).rejects.toThrow(/ok=/)
    expect(db.stageUpdates).toEqual([])
    expect(watcherWrites()[0]).toMatchObject({ op: 'update', values: { metric: 'custo_checkout', target: 12 } })
  })

  it('blank meta: no stage meta and no result watcher, as before', async () => {
    await expect(saveResult(context, form({ resultado: 'lead', cost_target: '' }))).rejects.toThrow(/ok=/)
    expect(db.stageUpdates).toEqual([['cap', { meta: null }]])
    expect(watcherWrites()).toMatchObject([{ op: 'delete', filters: [['id', 'w-p']] }])
  })

  it('refuses a faixa padrão where crítico comes before atenção', async () => {
    await expect(saveBand(context, form({ warn_pct: '40', crit_pct: '20' }))).rejects.toThrow(/erro=o crítico precisa ser maior/)
  })
})
