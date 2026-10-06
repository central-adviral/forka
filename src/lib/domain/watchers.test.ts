import { describe, it, expect } from 'vitest'
import { formatMetric, thresholds } from './watchers'

describe('thresholds', () => {
  it('puts the bands above the target for a cost', () => {
    expect(thresholds('cpa_geral', 55, 20, 40)).toEqual({ warn: 66, crit: 77 })
  })

  it('puts the bands below the target for a rate', () => {
    const band = thresholds('connect_rate', 75, 10, 20)
    expect(band.warn).toBeCloseTo(67.5)
    expect(band.crit).toBeCloseTo(60)
  })
})

describe('formatMetric', () => {
  it('formats costs as reais and rates as percent', () => {
    expect(formatMetric('cpl', 7.4)).toBe('R$ 7,40')
    expect(formatMetric('ctr', 1.234)).toBe('1,2%')
    expect(formatMetric('cpl', null)).toBe('—')
  })
})
