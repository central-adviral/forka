import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Call {
  table: string
  op: 'select' | 'update' | 'insert'
  values?: Record<string, unknown>
  filters: [string, unknown][]
}

const FUNNEL = '11111111-1111-4111-8111-111111111111'
const FRONT = '22222222-2222-4222-8222-222222222222'
const STAGE = '33333333-3333-4333-8333-333333333333'

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  watcher: null as { id: string; metric: string; front_id: string | null; stage_id: string | null; plan_role: string | null } | null,
  resultado: 'compra' as string,
  archived: null as string | null,
  written: [{ id: 'w-1' }] as { id: string }[],
  stageMeta: 6 as number | null,
}))

// A query builder that records what it was asked and answers from `db`.
function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  db.calls.push(call)
  const one = () => {
    if (table === 'watchers') return db.watcher
    if (table === 'sales_funnels') return { resultado: db.resultado, archived_at: db.archived === 'funil' ? '2026-10-01' : null }
    if (table === 'project_fronts') return { sales_funnel_id: FUNNEL, archived_at: db.archived === 'frente' ? '2026-10-01' : null }
    return { sales_funnel_id: FUNNEL, archived_at: db.archived === 'etapa' ? '2026-10-01' : null }
  }
  const builder = {
    select: () => builder,
    update: (values: Record<string, unknown>) => Object.assign(call, { op: 'update', values }) && builder,
    insert: (values: Record<string, unknown>) => Object.assign(call, { op: 'insert', values }) && builder,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value])
      return builder
    },
    maybeSingle: async () => ({ data: one(), error: null }),
    then: (resolve: (value: unknown) => void) =>
      resolve(
        table === 'project_fronts' && call.op === 'select'
          ? { data: [{ id: FRONT, stage_id: STAGE, metrica_principal: null, alvo_principal: null, metrica_secundaria: null, alvo_secundaria: null }], error: null }
          : { data: db.written, error: null }
      ),
  }
  return builder
}

const evaluate = vi.hoisted(() => vi.fn(async () => ({ data: 1, error: null })))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ from, rpc: async () => ({ data: true, error: null }) }) }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn(() => ({ rpc: evaluate })) }))
vi.mock('@/lib/repo/funnel-stages-repo', () => ({
  getFunnelStages: async () => [{ id: STAGE, measure: 'lead', position: 0, archivedAt: null, meta: db.stageMeta, metaRoas: null }],
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${decodeURIComponent(to)}`)
  },
}))

import { createWatcher, evaluateNow, updateWatcher } from './watcher-actions'

const context = { client_id: 'client-1', client_slug: 'voe', funnel_slug: 't15', sales_funnel_id: FUNNEL }

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const writes = (table: string, op: 'update' | 'insert') => db.calls.filter((call) => call.table === table && call.op === op)

describe('the vigias of a funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.calls = []
    db.resultado = 'compra'
    db.archived = null
    db.written = [{ id: 'w-1' }]
    db.stageMeta = 6
    db.watcher = { id: 'w-1', metric: 'cpm', front_id: null, stage_id: null, plan_role: null }
  })

  it('creates a stage watcher that follows the stage meta and the faixa padrão', async () => {
    await expect(createWatcher(context, form({ scope: `etapa:${STAGE}`, metric: 'cpl', target_mode: 'segue', band_mode: 'segue' }))).rejects.toThrow(/ok=Vigia de CPL criado/)
    expect(writes('watchers', 'insert')[0].values).toEqual({
      client_id: 'client-1',
      sales_funnel_id: FUNNEL,
      front_id: null,
      stage_id: STAGE,
      metric: 'cpl',
      target: null,
      warn_pct: null,
      crit_pct: null,
      min_spend: 0,
    })
  })

  it('refuses "segue" when nothing above has a meta for the metric', async () => {
    db.stageMeta = null
    await expect(createWatcher(context, form({ scope: `frente:${FRONT}`, metric: 'cpl', target_mode: 'segue' }))).rejects.toThrow(/erro=Não há meta acima para seguir/)
    await expect(createWatcher(context, form({ scope: 'funil', metric: 'ctr', target_mode: 'segue' }))).rejects.toThrow(/erro=Não há meta acima para seguir/)
    expect(writes('watchers', 'insert')).toEqual([])
  })

  it('changes a free watcher: scope, metric, specific target and own band; clears the verdict and judges again', async () => {
    await expect(
      updateWatcher({ ...context, watcher_id: 'w-1' }, form({ scope: `frente:${FRONT}`, metric: 'cpm', target_mode: 'especifica', target: '15,5', band_mode: 'propria', warn_pct: '10', crit_pct: '30', min_spend: '1.000' }))
    ).rejects.toThrow(/ok=Vigia salvo e reavaliado/)
    expect(writes('watchers', 'update')[0].values).toEqual({
      front_id: FRONT,
      stage_id: null,
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

  it('keeps the metric and meta of a result watcher; only its band and minimum change here', async () => {
    db.watcher = { id: 'w-1', metric: 'cpa_geral', front_id: null, stage_id: null, plan_role: 'principal' }
    await expect(updateWatcher({ ...context, watcher_id: 'w-1' }, form({ target_mode: 'especifica', target: '80', band_mode: 'segue' }))).rejects.toThrow(/ok=/)
    expect(writes('watchers', 'update')[0].values).toEqual({ warn_pct: null, crit_pct: null, min_spend: 0, last_value: null, last_status: null })
  })

  it('refuses CPA geral on a front, CPA de anúncio on a stage, and ROAS on a funnel without sales', async () => {
    await expect(updateWatcher({ ...context, watcher_id: 'w-1' }, form({ scope: `frente:${FRONT}`, metric: 'cpa_geral', target: '50' }))).rejects.toThrow(/erro=CPA geral vale para o funil ou uma etapa/)
    await expect(createWatcher(context, form({ scope: `etapa:${STAGE}`, metric: 'cpa_anuncio', target: '50' }))).rejects.toThrow(/erro=Numa etapa, use CPA geral/)
    db.resultado = 'lead'
    await expect(createWatcher(context, form({ scope: 'funil', metric: 'roas', target: '2' }))).rejects.toThrow(/erro=ROAS precisa de vendas/)
    expect(writes('watchers', 'update')).toEqual([])
    expect(writes('watchers', 'insert')).toEqual([])
  })

  it('refuses a band where crítico comes before atenção, and archived funnels, stages and fronts', async () => {
    await expect(updateWatcher({ ...context, watcher_id: 'w-1' }, form({ target: '8', band_mode: 'propria', warn_pct: '50', crit_pct: '30' }))).rejects.toThrow(/erro=na faixa própria, o crítico/)
    db.archived = 'funil'
    await expect(createWatcher(context, form({ scope: 'funil', metric: 'cpm', target: '15' }))).rejects.toThrow(/erro=Funil arquivado/)
    db.archived = 'etapa'
    await expect(createWatcher(context, form({ scope: `etapa:${STAGE}`, metric: 'cpm', target: '15' }))).rejects.toThrow(/erro=Etapa arquivada/)
    db.archived = 'frente'
    await expect(createWatcher(context, form({ scope: `frente:${FRONT}`, metric: 'cpm', target: '15' }))).rejects.toThrow(/erro=Frente arquivada/)
    expect(writes('watchers', 'insert')).toEqual([])
  })

  it('reports a write the policies refused and does not evaluate', async () => {
    db.written = []
    await expect(updateWatcher({ ...context, watcher_id: 'w-1' }, form({ scope: 'funil', metric: 'cpm', target: '80' }))).rejects.toThrow(/erro=Só gestor ou owner pode editar vigias/)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('evaluates only for a gestor', async () => {
    await expect(evaluateNow(context)).rejects.toThrow(/ok=1 vigias do cliente avaliados/)
    expect(evaluate).toHaveBeenCalledWith('evaluate_watchers', { p_client_id: 'client-1' })
  })
})
