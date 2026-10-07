import { describe, it, expect } from 'vitest'
import { DEFAULT_RULES } from './backlog'
import { readLinkTest, readMetaTest, readoutSummary, tagKey } from './backlog-readout'

function seeded(seed = 7): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

describe('backlog readout', () => {
  it('finds the variant tag of a test in the ad name, ignoring other tests and case', () => {
    expect(tagKey('Prova social [T4-b] v2', 'T4')).toBe('B')
    expect(tagKey('Prova social [T41-B]', 'T4')).toBeNull()
    expect(tagKey('Sem tag', 'T4')).toBeNull()
  })

  it('cuts a variant that spent mult × teto with no sale and crowns one under the teto with enough purchases', () => {
    const rows = [
      { ad_name: 'Video [T4-A]', spend: 300, sales_count: 6 },
      { ad_name: 'Video copia [T4-A]', spend: 100, sales_count: 4 },
      { ad_name: 'Estático [T4-B]', spend: 75, sales_count: 0 },
      { ad_name: 'Carrossel [T4-C]', spend: 20, sales_count: 0 },
      { ad_name: 'Outro teste [T5-B]', spend: 999, sales_count: 0 },
    ]
    const read = readMetaTest('T4', ['A', 'B', 'C', 'D'], rows, DEFAULT_RULES, 1.1)
    expect(read.map((v) => v.verdict)).toEqual(['win', 'cut', 'measuring', 'no_data'])
    expect(read[0]).toMatchObject({ ads: 2, sales: 10 })
    expect(read[0].spend).toBeCloseTo(440)
    expect(read[0].cpa).toBeCloseTo(44)
  })

  it('only calls a link test past the visitor floor on both sides', () => {
    const control = { variant_id: 'a', variant_name: 'Atual', visits: 600, conversions: 30 }
    const better = { variant_id: 'b', variant_name: 'Nova', visits: 600, conversions: 70 }
    expect(readLinkTest([control, better], 'a', DEFAULT_RULES, seeded()).map((v) => v.verdict)).toEqual(['measuring', 'win'])
    expect(readLinkTest([control, { ...better, visits: 100, conversions: 20 }], 'a', DEFAULT_RULES, seeded())[1].verdict).toBe('measuring')
    const worse = { variant_id: 'c', variant_name: 'Pior', visits: 600, conversions: 5 }
    expect(readLinkTest([control, worse], 'a', DEFAULT_RULES, seeded())[1].verdict).toBe('cut')
  })

  it('says win first, then cut, then saturation of a creative test', () => {
    expect(readoutSummary([{ label: 'B', verdict: 'win' }, { label: 'C', verdict: 'cut' }], 3, DEFAULT_RULES, 'meta')).toBe('vencedora pelas regras: B')
    expect(readoutSummary([{ label: 'C', verdict: 'cut' }], 3, DEFAULT_RULES, 'meta')).toBe('cortar: C')
    expect(readoutSummary([{ label: 'A', verdict: 'measuring' }], 12, DEFAULT_RULES, 'meta')).toBe('12 dias rodando, pede decisão')
    expect(readoutSummary([{ label: 'A', verdict: 'measuring' }], 12, DEFAULT_RULES, 'link')).toBeNull()
  })
})
