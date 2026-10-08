import { describe, it, expect } from 'vitest'
import { reportTrust, type TrustArm } from './test-trust'

// Control at 2% needs ~7,700 people per side for a 30% lift at 95% (the backlog's defaults).
const arms = (visits: number, weights: [number, number] = [50, 50]): TrustArm[] => [
  { isControl: true, weightPct: weights[0], visits, conversions: Math.round(visits * 0.02) },
  { isControl: false, weightPct: weights[1], visits, conversions: Math.round(visits * 0.026) },
]

describe('reportTrust', () => {
  it('is trustworthy only with the sample on every live side and a full week', () => {
    const result = reportTrust('ok', arms(9000), 9)
    expect(result.trustworthy).toBe(true)
    expect(result.needed).toBe(7716)
  })

  it('holds the seal back on a balanced draw that is still short of the sample', () => {
    const result = reportTrust('ok', arms(800), 12)
    expect(result.trustworthy).toBe(false)
    expect(result.strikeConfidence).toBe(false)
    expect(result.badge).toContain('amostra insuficiente')
    expect(result.explain).toContain('a menor tem 800')
  })

  it('holds the seal back before seven days even with the sample in', () => {
    const result = reportTrust('ok', arms(9000), 4)
    expect(result.trustworthy).toBe(false)
    expect(result.explain).toContain('3 dias para fechar a semana')
  })

  it('ignores a parked variant (weight 0) when finding the smallest side', () => {
    const withParked = [...arms(9000), { isControl: false, weightPct: 0, visits: 40, conversions: 0 }]
    expect(reportTrust('ok', withParked, 9).trustworthy).toBe(true)
  })

  it('strikes the confidence only for a skewed draw', () => {
    const result = reportTrust('mismatch', arms(9000), 9)
    expect(result.strikeConfidence).toBe(true)
    expect(result.badge).toContain('fora do peso')
  })

  it('names why the draw could not be checked instead of always blaming volume', () => {
    expect(reportTrust('single_variant', arms(9000), 9).badge).toContain('só 1 variante')
    expect(reportTrust('too_many', arms(9000), 9).badge).toContain('não conferido')
    expect(reportTrust('no_data', arms(30), 1).badge).toContain('sem volume')
  })

  it('cannot size the sample while the control has no conversion', () => {
    const result = reportTrust('ok', [{ isControl: true, weightPct: 50, visits: 900, conversions: 0 }, { isControl: false, weightPct: 50, visits: 900, conversions: 5 }], 10)
    expect(result.trustworthy).toBe(false)
    expect(result.needed).toBeNull()
  })
})
