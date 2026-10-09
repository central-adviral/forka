import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProjectSetupStatus } from './project-setup-repo'

// A stand-in for the Supabase client: each table answers with fixed rows, whatever the filters.
// Enough to check how the facts turn into the five steps; the real queries run in integration.
interface Fixture {
  client: { funnel_source_url: string | null } | null
  project: { warn_pct: number; crit_pct: number } | null
  secrets: { funnel_source_service_role_key: string | null; hubla_webhook_token: string | null } | null
  products: { papel: string }[]
  stages: { id: string; name: string; tag: string | null; measure: string; meta: number | null; meta_roas: number | null }[]
  fronts: { id: string; name: string; stage_id: string; source_sales_funnel_id: string | null; naming_rules: { kind: string; value: string }[] }[]
  pages?: { front_id: string | null }[]
  quality?: Record<string, number> | null
}

function fakeDb(fixture: Fixture): SupabaseClient {
  const answer: Record<string, () => { data?: unknown }> = {
    clients: () => ({ data: fixture.client }),
    sales_funnels: () => ({ data: fixture.project }),
    client_secrets: () => ({ data: fixture.secrets }),
    project_products: () => ({ data: fixture.products }),
    funnel_stages: () => ({ data: fixture.stages }),
    project_fronts: () => ({ data: fixture.fronts }),
    pages: () => ({ data: fixture.pages ?? [{ front_id: 'f1' }, { front_id: 'f2' }] }),
  }
  return {
    rpc: async () => ({ data: fixture.quality === null ? null : [fixture.quality ?? {}], error: null }),
    from(table: string) {
      const result = { error: null, data: null, count: null, ...answer[table]() }
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) => resolve(result),
      }
      for (const method of ['select', 'eq', 'is', 'in', 'order', 'maybeSingle']) chain[method] = () => chain
      return chain
    },
  } as unknown as SupabaseClient
}

const READY: Fixture = {
  client: { funnel_source_url: 'https://launchops.example.com' },
  project: { warn_pct: 20, crit_pct: 40 },
  secrets: { funnel_source_service_role_key: 'k', hubla_webhook_token: 't' },
  products: [{ papel: 'entrada' }, { papel: 'order_bump' }],
  stages: [
    { id: 's1', name: 'Captação', tag: 'CAP', measure: 'lead', meta: 6, meta_roas: null },
    { id: 's2', name: 'Vendas', tag: 'VND', measure: 'compra', meta: null, meta_roas: 2 },
  ],
  fronts: [
    { id: 'f1', name: 'Frio', stage_id: 's1', source_sales_funnel_id: null, naming_rules: [{ kind: 'include', value: 'FRIO' }, { kind: 'exclude', value: 'X' }] },
    { id: 'f2', name: 'Base', stage_id: 's2', source_sales_funnel_id: null, naming_rules: [{ kind: 'include', value: 'BASE' }] },
  ],
}

async function status(overrides: Partial<Fixture>) {
  const db = fakeDb({ ...READY, ...overrides })
  return getProjectSetupStatus(db, db, 'client-1', 'project-1')
}
// Conferir is pending whenever another step is: these cases look at the step that causes it.
const pending = (result: Awaited<ReturnType<typeof status>>) => result!.steps.filter((step) => !step.done && step.id !== 'conferir').map((step) => step.id)
const text = (result: Awaited<ReturnType<typeof status>>, id: string) => result!.steps.find((step) => step.id === id)!.text

describe('getProjectSetupStatus', () => {
  it('is 5/5 when every step is set, with the menu names', async () => {
    const result = await status({})
    expect(result!.done).toBe(5)
    expect(result!.steps.map((step) => step.label)).toEqual(['Integrações', 'Etapas e frentes', 'Produtos', 'Metas e vigias', 'Conferir'])
    expect(text(result, 'etapas')).toBe('2 etapas, 2 frentes.')
  })

  it('1. Integrações: needs LaunchOps (URL and key) and the Hubla token', async () => {
    expect(pending(await status({ secrets: { funnel_source_service_role_key: 'k', hubla_webhook_token: null } }))).toEqual(['integracoes'])
    expect(pending(await status({ client: { funnel_source_url: null } }))).toEqual(['integracoes'])
    expect(text(await status({ secrets: null }), 'integracoes')).toBe('Falta conectar LaunchOps e Hubla.')
  })

  it('2. Etapas e frentes: stage tags with more than one stage, no repeated tag, every own front with a "contém"', async () => {
    const noTag = await status({ stages: [{ ...READY.stages[0], tag: null }, READY.stages[1]] })
    expect(pending(noTag)).toEqual(['etapas'])
    expect(text(noTag, 'etapas')).toBe('Falta: etiqueta da etapa Captação.')
    expect(pending(await status({ stages: [{ ...READY.stages[1], tag: null }], fronts: [READY.fronts[1]] }))).toEqual([])
    expect(text(await status({ stages: [READY.stages[0], { ...READY.stages[1], tag: 'cap' }] }), 'etapas')).toContain('etiqueta CAP repetida (Captação, Vendas)')
    const excludeOnly = await status({ fronts: [{ ...READY.fronts[0], naming_rules: [{ kind: 'exclude', value: 'X' }] }, READY.fronts[1]] })
    expect(text(excludeOnly, 'etapas')).toBe('Falta: etiqueta da frente Frio.')
    const twins = await status({ fronts: [...READY.fronts, { ...READY.fronts[0], id: 'f3', name: 'Frio 2', naming_rules: [{ kind: 'include', value: 'frio' }] }] })
    expect(text(twins, 'etapas')).toContain('frentes Frio e Frio 2 com a mesma etiqueta')
    expect(text(await status({ fronts: [] }), 'etapas')).toBe('Falta: ao menos uma frente.')
    expect(text(await status({ stages: [] }), 'etapas')).toBe('Falta: ao menos uma etapa.')
  })

  it('2. Etapas e frentes: a mirror needs no rule; a front without page is only said', async () => {
    const mirror = await status({ fronts: [READY.fronts[0], { ...READY.fronts[1], source_sales_funnel_id: 'other', naming_rules: [] }] })
    expect(pending(mirror)).toEqual([])
    const noPage = await status({ pages: [] })
    expect(pending(noPage)).toEqual([])
    expect(text(noPage, 'etapas')).toBe('2 etapas, 2 frentes; 2 frentes sem página (opcional).')
  })

  it('3. Produtos: an entry product when a stage sells, an ascension product when a stage ascends', async () => {
    expect(text(await status({ products: [] }), 'produtos')).toBe('Nenhum produto de entrada: nenhuma venda conta ainda.')
    const ascends = await status({ stages: [...READY.stages, { id: 's3', name: 'Ascensão', tag: 'ASC', measure: 'ascensao', meta: 0.1, meta_roas: null }] })
    expect(pending(ascends)).toEqual(['produtos'])
    expect(text(ascends, 'produtos')).toBe('Há etapa de ascensão sem produto de ascensão.')
    const leadOnly = await status({ stages: [READY.stages[0]], fronts: [READY.fronts[0]], products: [] })
    expect(pending(leadOnly)).toEqual([])
    expect(text(leadOnly, 'produtos')).toBe('Sem etapa de compra: o funil não conta vendas.')
  })

  it('4. Metas e vigias: every stage has a meta (a ROAS floor counts for compra)', async () => {
    const result = await status({ stages: [{ ...READY.stages[0], meta: null }, READY.stages[1]] })
    expect(pending(result)).toEqual(['metas'])
    expect(text(result, 'metas')).toBe('Falta a meta de: Captação (edite no canvas).')
    expect(text(await status({}), 'metas')).toBe('Toda etapa tem meta; faixa +20% / +40%.')
  })

  it('returns null for a funnel the session cannot see', async () => {
    expect(await status({ project: null })).toBeNull()
    expect(await status({ client: null })).toBeNull()
  })

  it('Conferir: done only with every step done and no quality seal open', async () => {
    const sealed = await status({ quality: { cliente_campanhas_em_disputa: 1 } })
    const check = sealed!.steps.find((step) => step.id === 'conferir')!
    expect(check.done).toBe(false)
    expect(check.text).toContain('1 campanha em disputa')
    expect((await status({}))!.steps.find((step) => step.id === 'conferir')!.done).toBe(true)
  })
})
