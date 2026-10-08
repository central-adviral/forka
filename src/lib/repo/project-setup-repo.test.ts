import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProjectSetupStatus } from './project-setup-repo'

// A stand-in for the Supabase client: each table answers with fixed rows or a count, whatever the
// filters. Enough to check how the five facts turn into steps; the real queries run in integration.
interface Fixture {
  client: { funnel_source_url: string | null } | null
  project: { resultado: string | null } | null
  secrets: { funnel_source_service_role_key: string | null; hubla_webhook_token: string | null } | null
  entryProducts: number
  namingRules: number
  watchers: { metric: string; front_id: string | null; target: number }[]
}

function fakeDb(fixture: Fixture): SupabaseClient {
  const answer: Record<string, () => { data?: unknown; count?: number }> = {
    clients: () => ({ data: fixture.client }),
    sales_funnels: () => ({ data: fixture.project }),
    client_secrets: () => ({ data: fixture.secrets }),
    project_products: () => ({ count: fixture.entryProducts }),
    naming_rules: () => ({ count: fixture.namingRules }),
    watchers: () => ({ data: fixture.watchers }),
  }
  return {
    from(table: string) {
      const result = { error: null, data: null, count: null, ...answer[table]() }
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) => resolve(result),
      }
      for (const method of ['select', 'eq', 'is', 'in', 'maybeSingle']) chain[method] = () => chain
      return chain
    },
  } as unknown as SupabaseClient
}

const READY: Fixture = {
  client: { funnel_source_url: 'https://launchops.example.com' },
  project: { resultado: 'compra' },
  secrets: { funnel_source_service_role_key: 'k', hubla_webhook_token: 't' },
  entryProducts: 1,
  namingRules: 3,
  watchers: [
    { metric: 'cpa_geral', front_id: null, target: 60 },
    { metric: 'ctr', front_id: 'f1', target: 1.2 },
  ],
}

async function status(overrides: Partial<Fixture>) {
  const db = fakeDb({ ...READY, ...overrides })
  return getProjectSetupStatus(db, db, 'client-1', 'project-1')
}
const pending = (result: Awaited<ReturnType<typeof status>>) => result!.steps.filter((step) => !step.done).map((step) => step.id)

describe('getProjectSetupStatus', () => {
  it('is 5/5 when every step is set', async () => {
    const result = await status({})
    expect(result!.done).toBe(5)
    expect(pending(result)).toEqual([])
  })

  it('1. Integrações: needs LaunchOps (URL and key) and the Hubla token', async () => {
    expect(pending(await status({ secrets: { funnel_source_service_role_key: 'k', hubla_webhook_token: null } }))).toEqual(['integracoes'])
    expect(pending(await status({ client: { funnel_source_url: null } }))).toEqual(['integracoes'])
    const none = await status({ secrets: null })
    expect(none!.steps[0].text).toBe('Falta conectar LaunchOps e Hubla.')
  })

  it('2. Produtos: needs at least one product with the entry role', async () => {
    const result = await status({ entryProducts: 0 })
    expect(pending(result)).toEqual(['produtos'])
    expect(result!.done).toBe(4)
  })

  it('3. Regras de campanha: needs at least one naming rule', async () => {
    expect(pending(await status({ namingRules: 0 }))).toEqual(['regras'])
  })

  it('4. Plano: needs the result and the cost target (the project-wide cost watcher)', async () => {
    // Only the CTR watcher left: no cost target, and it still counts as an extra watcher.
    expect(pending(await status({ watchers: [{ metric: 'ctr', front_id: 'f1', target: 1.2 }] }))).toEqual(['plano'])
    // A lead project's cost watcher is the CPL one; a CPA watcher does not stand in for it.
    expect(pending(await status({ project: { resultado: 'lead' } }))).toEqual(['plano'])
  })

  it('5. Metas: needs a watcher besides the cost one', async () => {
    const result = await status({ watchers: [{ metric: 'cpa_geral', front_id: null, target: 60 }] })
    expect(pending(result)).toEqual(['metas'])
    expect(result!.steps.find((step) => step.id === 'metas')!.text).toContain('Só o vigia de custo')
  })

  it('returns null for a project the session cannot see', async () => {
    expect(await status({ project: null })).toBeNull()
    expect(await status({ client: null })).toBeNull()
  })
})
