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
        bestVariant: { testName: 'Página de vendas', testSlug: 'pagina-de-vendas', variantName: 'Página B', liftPct: 55 },
      })
    )
    expect(items.map((item) => item.severity)).toEqual(['crit', 'warn', 'ok'])
    expect(items[1].href).toBe('/dashboard/clients/voe/funis-venda/t15/regras')
    expect(items[2].href).toBe('/dashboard/clients/voe/tests/pagina-de-vendas')
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

  it('warns about sales no project owns, and stays quiet when there are none', () => {
    const items = buildAttention(input({ unattributed: { count: 3, revenue: 591 } }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ severity: 'warn', title: 'Vendas sem projeto', tool: 'config' })
    expect(items[0].detail).toMatch(/^3 vendas \(R\$\s?591\)/)
    expect(buildAttention(input({ unattributed: { count: 0, revenue: 0 } }))).toEqual([])
  })

  it('brings the backlog verdicts to the queue, a cut as critical, each opening its own card', () => {
    const items = buildAttention(
      input({
        testVerdicts: [
          { code: 'T5', title: 'Preço ancorado', summary: 'vencedora pelas regras: B', kind: 'win', projectSlug: '1k-latam', daysRunning: 12 },
          { code: 'T4', title: 'Carrossel de bônus', summary: 'cortar: B', kind: 'cut', projectSlug: '1k-latam', daysRunning: 5 },
        ],
      })
    )
    expect(items.map((item) => [item.severity, item.title])).toEqual([
      ['crit', 'T4 · cortar: B'],
      ['warn', 'T5 · vencedora pelas regras: B'],
    ])
    expect(items[1]).toMatchObject({ tool: 'ab', action: 'Decidir', href: '/dashboard/clients/voe/backlog?projeto=1k-latam&item=T5' })
    expect(items[1].detail).toContain('12 dias rodando')
  })
})
