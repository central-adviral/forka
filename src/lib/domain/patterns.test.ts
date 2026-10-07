import { describe, it, expect } from 'vitest'
import { analyzePatterns, type PatternDay } from './patterns'

// Bad days here come from a falling CTR: CPM, connect and conversion stay put.
const day = (data: string, cost: number, ctr: number): PatternDay => ({
  data,
  spend: 1000,
  cost,
  metrics: { cpm: 90, ctr, connectRate: 80, pvToIc: 20, conv: 2 },
})

const days = [day('2026-10-01', 40, 2.0), day('2026-10-02', 42, 1.9), day('2026-10-03', 60, 1.3), day('2026-10-04', 62, 1.2)]

describe('analyzePatterns', () => {
  it('finds the best and the worst day by cost', () => {
    const report = analyzePatterns(days)!
    expect(report.best.data).toBe('2026-10-01')
    expect(report.worst.data).toBe('2026-10-04')
  })

  it('names the metric that separates bad days from good ones, in the direction that hurts', () => {
    const report = analyzePatterns(days)!
    expect(report.separator).toBe('ctr')
    const ctr = report.goodVsBad.find((row) => row.metric === 'ctr')!
    expect(ctr.worse).toBe(true)
    expect(ctr.changePct).toBeCloseTo(-35.9, 0)
    expect(report.suggestions.map((s) => s.metric)).toEqual(['ctr'])
  })

  it('reads the CTR as moving against the cost', () => {
    const report = analyzePatterns(days)!
    const ctr = report.correlation.find((row) => row.metric === 'ctr')!
    expect(ctr.r).toBeLessThan(-0.9)
  })

  it('lists, per day, the metrics that moved at least 10% against their median', () => {
    const report = analyzePatterns(days)!
    const worst = report.drivers.find((row) => row.data === '2026-10-04')!
    expect(worst.moved.map((m) => m.metric)).toEqual(['ctr'])
    expect(worst.vsMedianPct).toBeGreaterThan(0)
  })

  it('needs at least four days with a cost and enough spend', () => {
    expect(analyzePatterns(days.slice(0, 3))).toBeNull()
    expect(analyzePatterns(days, 5000)).toBeNull()
  })
})
