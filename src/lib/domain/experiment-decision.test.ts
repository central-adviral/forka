import { describe, it, expect } from 'vitest'
import { decisionRows, linkVerdict, matchTestVariant, type TestVariantRow } from './experiment-decision'
import type { LinkVariantRead } from './backlog-readout'

const variants: TestVariantRow[] = [
  { id: 'a', name: 'A · Preço cheio', weight_pct: 50, destination_url: 'https://x.com/a', thank_you_url: null, is_control: true },
  { id: 'b', name: 'Preço ancorado', weight_pct: 50, destination_url: 'https://x.com/b', thank_you_url: null, is_control: false },
]

describe('matchTestVariant', () => {
  it('matches by name, ignoring case and spaces', () => {
    expect(matchTestVariant({ key: 'B', name: ' preço ancorado ' }, variants)).toBe('b')
  })

  it('matches a test variant named after the card key', () => {
    expect(matchTestVariant({ key: 'A', name: 'Controle' }, variants)).toBe('a')
    expect(matchTestVariant({ key: 'C', name: 'Outra' }, [{ id: 'c', name: 'C' }])).toBe('c')
  })

  it('does not take a name that only starts with the same letter', () => {
    expect(matchTestVariant({ key: 'A', name: 'Controle' }, [{ id: 'x', name: 'Alpha nova' }])).toBeNull()
  })
})

describe('decisionRows', () => {
  it('sends all traffic to the winner and parks the rest at weight 0', () => {
    const rows = decisionRows(variants, 'b', { sendAllTraffic: true, makeControl: false })
    expect(rows.map((row) => [row.id, row.weight_pct, row.is_control])).toEqual([
      ['a', 0, true],
      ['b', 100, false],
    ])
  })

  it('makes the winner the control, the old control losing the flag first', () => {
    const rows = decisionRows(variants, 'b', { sendAllTraffic: true, makeControl: true })
    expect(rows.map((row) => [row.id, row.is_control])).toEqual([
      ['a', false],
      ['b', true],
    ])
    expect(rows.reduce((sum, row) => sum + row.weight_pct, 0)).toBe(100)
  })

  it('keeps the weights when only the control changes', () => {
    const rows = decisionRows(variants, 'b', { sendAllTraffic: false, makeControl: true })
    expect(rows.map((row) => row.weight_pct)).toEqual([50, 50])
  })
})

describe('linkVerdict', () => {
  const read = (overrides: Partial<LinkVariantRead> = {}): LinkVariantRead[] => [
    { name: 'A · controle', isControl: true, weightPct: 50, visits: 8120, conversions: 219, chance: null, needed: 7700, verdict: 'measuring' },
    { name: 'B · ancorado', isControl: false, weightPct: 50, visits: 7980, conversions: 261, chance: 0.96, needed: 7700, verdict: 'win', ...overrides },
  ]

  it('names the winner, the lift and every check that backs it', () => {
    const verdict = linkVerdict(read(), 12, true)!
    expect(verdict.winnerName).toBe('B · ancorado')
    expect(verdict.chancePct).toBe(96)
    expect(verdict.liftPct).toBe(21)
    expect(verdict.checks.filter((check) => check.ok).map((check) => check.label)).toEqual(['Amostra', 'Sorteio no peso', 'Ciclo de 7+ dias', 'Sem outro teste na camada'])
  })

  it('flags a short cycle and a test outside a project', () => {
    const verdict = linkVerdict(read(), 5, false)!
    expect(verdict.checks.find((check) => check.label.startsWith('Ciclo'))!.ok).toBe(false)
    expect(verdict.checks.find((check) => check.label.startsWith('Sem outro'))!.value).toContain('sem projeto')
  })

  it('has no verdict while nobody wins', () => {
    expect(linkVerdict(read({ verdict: 'measuring' }), 12, true)).toBeNull()
  })
})
