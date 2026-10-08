import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Call {
  table: string
  op: 'select' | 'update'
  values?: Record<string, unknown>
  filters: [string, unknown][]
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  watcher: null as { id: string; front_id: string | null; plan_role: string | null } | null,
  resultado: 'compra' as string,
  archivedTable: null as string | null,
  updated: [{ id: 'w-1' }] as { id: string }[],
}))

// A query builder that records what it was asked and answers from `db`.
function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  db.calls.push(call)
  const builder = {
    select: () => builder,
    update: (values: Record<string, unknown>) => {
      call.op = 'update'
      call.values = values
      return builder
    },
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value])
      return builder
    },
    maybeSingle: async () => ({
      data: table === 'watchers' ? db.watcher : { resultado: db.resultado, archived_at: db.archivedTable === table ? '2026-10-01T12:00:00Z' : null },
      error: null,
    }),
    then: (resolve: (value: unknown) => void) => resolve({ data: db.updated, error: null }),
  }
  return builder
}

const evaluate = vi.hoisted(() => vi.fn(async () => ({ data: 1, error: null })))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ from, rpc: async () => ({ data: true, error: null }) }) }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn(() => ({ rpc: evaluate })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${decodeURIComponent(to)}`)
  },
}))

import { createWatcher, updateWatcher } from './actions'

const context = { client_id: 'client-1', client_slug: 'voe', watcher_id: 'w-1' }
const funnel = '11111111-1111-1111-1111-111111111111'
const front = '22222222-2222-2222-2222-222222222222'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const updates = (table: string) => db.calls.filter((call) => call.table === table && call.op === 'update')

describe('updateWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.calls = []
    db.resultado = 'compra'
    db.archivedTable = null
    db.updated = [{ id: 'w-1' }]
  })

  it('changes the scope, metric and band of a watcher made in Metas, clears the old verdict and judges it again', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: null }
    await expect(
      updateWatcher(context, form({ scope: `${funnel}|${front}`, metric: 'cpm', target: '15,5', warn_pct: '10', crit_pct: '30', min_spend: '1.000' }))
    ).rejects.toThrow(/redirect:.*ok=Vigia salvo e reavaliado/)
    expect(updates('watchers')[0].values).toEqual({
      sales_funnel_id: funnel,
      front_id: front,
      metric: 'cpm',
      target: 15.5,
      warn_pct: 10,
      crit_pct: 30,
      min_spend: 1000,
      last_value: null,
      last_status: null,
    })
    expect(evaluate).toHaveBeenCalledWith('evaluate_watchers', { p_client_id: 'client-1' })
  })

  it('refuses CPA geral on a front, as creating does, and changes nothing', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: null }
    await expect(updateWatcher(context, form({ scope: `${funnel}|${front}`, metric: 'cpa_geral', target: '50' }))).rejects.toThrow(/erro=CPA geral vale para todas as frentes/)
    expect(updates('watchers')).toEqual([])
  })

  it('refuses ROAS on a lead project, which has no sales', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: null }
    db.resultado = 'lead'
    await expect(updateWatcher(context, form({ scope: `${funnel}|`, metric: 'roas', target: '2' }))).rejects.toThrow(/erro=ROAS precisa de vendas/)
    expect(updates('watchers')).toEqual([])
  })

  it('keeps the metric of a plan watcher and writes its target on the watcher the Plano reads', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: 'principal' }
    await expect(updateWatcher(context, form({ scope: `${funnel}|${front}`, metric: 'cpm', target: '80', warn_pct: '20', crit_pct: '40' }))).rejects.toThrow(/ok=/)
    expect(updates('watchers')[0].values).toEqual({ target: 80, warn_pct: 20, crit_pct: 40, min_spend: 0, last_value: null, last_status: null })
    expect(updates('project_fronts')).toEqual([])
  })

  it('writes a front watcher target on the front, which the 0102 trigger copies to the watcher', async () => {
    db.watcher = { id: 'w-1', front_id: front, plan_role: 'secundaria' }
    await expect(updateWatcher(context, form({ target: '4', warn_pct: '15', crit_pct: '30', min_spend: '200' }))).rejects.toThrow(/ok=/)
    expect(updates('project_fronts')[0]).toMatchObject({ values: { alvo_secundaria: 4 }, filters: [['id', front]] })
    expect(updates('watchers')[0].values).toEqual({ warn_pct: 15, crit_pct: 30, min_spend: 200, last_value: null, last_status: null })
  })

  it('reports a write the policies refused and does not evaluate', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: 'principal' }
    db.updated = []
    await expect(updateWatcher(context, form({ target: '80' }))).rejects.toThrow(/erro=Só gestor ou owner pode editar vigias/)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('refuses editing a watcher of an archived project', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: 'principal' }
    db.archivedTable = 'sales_funnels'
    await expect(updateWatcher(context, form({ target: '80' }))).rejects.toThrow(/erro=Funil arquivado/)
    expect(updates('watchers')).toEqual([])
  })

  it('refuses editing a watcher of an archived front', async () => {
    db.watcher = { id: 'w-1', front_id: front, plan_role: 'secundaria' }
    db.archivedTable = 'project_fronts'
    await expect(updateWatcher(context, form({ target: '4' }))).rejects.toThrow(/erro=Frente arquivada/)
    expect(updates('project_fronts')).toEqual([])
    expect(updates('watchers')).toEqual([])
  })

  it('refuses creating a watcher on an archived front', async () => {
    db.archivedTable = 'project_fronts'
    await expect(createWatcher(context, form({ scope: `${funnel}|${front}`, metric: 'cpm', target: '15' }))).rejects.toThrow(/erro=Frente arquivada/)
  })

  it('refuses a band where crítico comes before atenção', async () => {
    db.watcher = { id: 'w-1', front_id: null, plan_role: 'principal' }
    await expect(updateWatcher(context, form({ target: '80', warn_pct: '50', crit_pct: '30' }))).rejects.toThrow(/erro=o crítico precisa ser maior/)
    expect(db.calls).toEqual([])
  })
})
