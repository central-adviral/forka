import { describe, it, expect } from 'vitest'
import { buildAttention, type AttentionInput } from './attention'

// 14:00 in São Paulo.
const now = new Date('2026-10-06T17:00:00Z')

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    base: '/dashboard/clients/voe',
    now,
    metaDataAt: '2026-10-06T16:07:00Z',
    lastRun: { finishedAt: '2026-10-06T16:12:00Z', error: null },
    conflicts: [],
    unclassified: { count: 0, spend: 0 },
    rulesHref: '/dashboard/clients/voe/funis-venda/t15/regras',
    bestVariant: null,
    ...overrides,
  }
}

describe('buildAttention', () => {
  it('stays empty when the data is fresh and every campaign has an owner', () => {
    expect(buildAttention(input())).toEqual([])
  })

  it('puts a failed read first, then the warnings, then the good news', () => {
    const items = buildAttention(
      input({
        lastRun: { finishedAt: '2026-10-06T16:12:00Z', error: 'timeout' },
        conflicts: [{ name: '12 - Remarketing', spend: 150 }],
        bestVariant: { testName: 'Página de vendas', variantName: 'Página B', liftPct: 55 },
      })
    )
    expect(items.map((item) => item.severity)).toEqual(['crit', 'warn', 'ok'])
    expect(items[1].href).toBe('/dashboard/clients/voe/funis-venda/t15/regras')
  })

  it('flags Meta data older than two hours during business hours', () => {
    const items = buildAttention(input({ metaDataAt: '2026-10-06T14:00:00Z' }))
    expect(items.map((item) => item.title)).toEqual(['Dados do Meta parados'])
  })

  it('does not flag stale Meta data at night', () => {
    expect(buildAttention(input({ now: new Date('2026-10-06T06:00:00Z'), metaDataAt: null }))).toEqual([])
  })

  it('asks for the first read when the client was never synced', () => {
    expect(buildAttention(input({ lastRun: null, metaDataAt: null }))[0].title).toBe('As campanhas deste cliente ainda não foram lidas')
  })
})

describe('buildAttention with watcher alerts', () => {
  it('lists an open alert as a Painel de Controle item, critical ones first', () => {
    const items = buildAttention({
      base: '/dashboard/clients/voe',
      now,
      metaDataAt: '2026-10-06T16:07:00Z',
      lastRun: { finishedAt: '2026-10-06T16:12:00Z', error: null },
      conflicts: [],
      unclassified: { count: 1, spend: 80 },
      rulesHref: null,
      bestVariant: null,
      watcherAlerts: [{ severity: 'crit', title: '1K · CPA geral crítico', detail: 'R$ 84,10 contra alvo de R$ 55,00' }],
    })
    expect(items[0]).toMatchObject({ severity: 'crit', tool: 'painel', href: '/dashboard/clients/voe/painel' })
    expect(items[1].tool).toBe('config')
  })
})
