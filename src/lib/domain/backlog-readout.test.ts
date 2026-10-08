import { describe, it, expect } from 'vitest'
import { DEFAULT_RULES } from './backlog'
import { readLinkTest, readMetaTest, readoutSummary, requiredVisitsPerArm, tagKey } from './backlog-readout'

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
      { ad_name: 'Video [T4-A]', spend: 330, sales_count: 6 },
      { ad_name: 'Video copia [T4-A]', spend: 110, sales_count: 4 },
      { ad_name: 'Estático [T4-B]', spend: 82.5, sales_count: 0 },
      { ad_name: 'Carrossel [T4-C]', spend: 20, sales_count: 0 },
      { ad_name: 'Outro teste [T5-B]', spend: 999, sales_count: 0 },
    ]
    const read = readMetaTest('T4', ['A', 'B', 'C', 'D'], rows, DEFAULT_RULES)
    expect(read.map((v) => v.verdict)).toEqual(['win', 'cut', 'measuring', 'no_data'])
    expect(read[0]).toMatchObject({ ads: 2, sales: 10 })
    expect(read[0].spend).toBeCloseTo(440)
    expect(read[0].cpa).toBeCloseTo(44)
  })

  it('waits for the sample the control rate calls for before calling a link test', () => {
    // 5% control rate, 30% minimum lift, 95% confidence: about 3 thousand people each side.
    const needed = requiredVisitsPerArm(0.05, 95, 30)!
    expect(needed).toBeGreaterThan(2800)
    expect(needed).toBeLessThan(3200)
    const control = { variant_id: 'a', variant_name: 'Atual', visits: 600, conversions: 30 }
    const better = { variant_id: 'b', variant_name: 'Nova', visits: 600, conversions: 70 }
    // A big lift on 600 people is still "measuring": stopping here is how false winners happen.
    const early = readLinkTest([control, better], 'a', DEFAULT_RULES, seeded())
    expect(early.map((v) => v.verdict)).toEqual(['measuring', 'measuring'])
    expect(early[1].needed).toBe(Math.max(DEFAULT_RULES.minVisits, requiredVisitsPerArm(30 / 600, 95, 30)!))

    const bigControl = { ...control, visits: 3200, conversions: 160 }
    expect(readLinkTest([bigControl, { ...better, visits: 3200, conversions: 230 }], 'a', DEFAULT_RULES, seeded())[1].verdict).toBe('win')
    expect(readLinkTest([bigControl, { ...better, visits: 3200, conversions: 100 }], 'a', DEFAULT_RULES, seeded())[1].verdict).toBe('cut')
  })

  it('has no sample size while the control has no conversion, and needs the minimum conversions to win', () => {
    expect(requiredVisitsPerArm(0, 95, 30)).toBeNull()
    const read = readLinkTest([{ variant_id: 'a', variant_name: 'Atual', visits: 900, conversions: 0 }, { variant_id: 'b', variant_name: 'Nova', visits: 900, conversions: 9 }], 'a', DEFAULT_RULES, seeded())
    expect(read[1]).toMatchObject({ needed: null, verdict: 'measuring' })
    // High rates make the sample small; the minimum conversions still guard the win.
    const strict = { ...DEFAULT_RULES, min: 50 }
    const small = readLinkTest([{ variant_id: 'a', variant_name: 'Atual', visits: 700, conversions: 140 }, { variant_id: 'b', variant_name: 'Nova', visits: 700, conversions: 235 }], 'a', strict, seeded())
    expect(small[1].verdict).toBe('win')
    expect(readLinkTest([{ variant_id: 'a', variant_name: 'Atual', visits: 700, conversions: 140 }, { variant_id: 'b', variant_name: 'Nova', visits: 700, conversions: 235 }], 'a', { ...strict, min: 300 }, seeded())[1].verdict).toBe('measuring')
  })

  it('says win first, then cut, then saturation of a creative test', () => {
    expect(readoutSummary([{ label: 'B', verdict: 'win' }, { label: 'C', verdict: 'cut' }], 3, DEFAULT_RULES, 'meta')).toBe('vencedora pelos critérios: B')
    expect(readoutSummary([{ label: 'C', verdict: 'cut' }], 3, DEFAULT_RULES, 'meta')).toBe('cortar: C')
    expect(readoutSummary([{ label: 'A', verdict: 'measuring' }], 12, DEFAULT_RULES, 'meta')).toBe('12 dias rodando, pede decisão')
    expect(readoutSummary([{ label: 'A', verdict: 'measuring' }], 12, DEFAULT_RULES, 'link')).toBeNull()
  })

  it('with three variants, a win needs the chance of being the best of all, not of beating the control', () => {
    // B and C both beat the control clearly, but neither is clearly the best of the two: no winner yet.
    const close = readLinkTest(
      [
        { variant_id: 'a', variant_name: 'Atual', visits: 9000, conversions: 180 },
        { variant_id: 'b', variant_name: 'B', visits: 9000, conversions: 270 },
        { variant_id: 'c', variant_name: 'C', visits: 9000, conversions: 272 },
      ],
      'a',
      DEFAULT_RULES
    )
    expect(close.map((variant) => variant.verdict)).toEqual(['measuring', 'measuring', 'measuring'])
    // C pulls away from B: now it is the best of all.
    const clear = readLinkTest(
      [
        { variant_id: 'a', variant_name: 'Atual', visits: 9000, conversions: 180 },
        { variant_id: 'b', variant_name: 'B', visits: 9000, conversions: 200 },
        { variant_id: 'c', variant_name: 'C', visits: 9000, conversions: 290 },
      ],
      'a',
      DEFAULT_RULES
    )
    expect(clear[2].verdict).toBe('win')
    expect(clear[1].verdict).toBe('measuring')
  })

  it('cuts a creative that sold, but at a CPA past the cut limit (one sale at R$ 300 against R$ 55)', () => {
    const read = readMetaTest('T4', ['A', 'B'], [
      { ad_name: 'Bônus [T4-A]', spend: 300, sales_count: 1 },
      { ad_name: 'UGC [T4-B]', spend: 300, sales_count: 6 },
    ], DEFAULT_RULES)
    expect(read.map((variant) => variant.verdict)).toEqual(['cut', 'measuring'])
  })
})

