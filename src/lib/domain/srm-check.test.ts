import { describe, it, expect } from 'vitest'
import { detectSampleRatioMismatch } from './srm-check'

describe('detectSampleRatioMismatch', () => {
  it('returns false when traffic split roughly matches configured weights', () => {
    const result = detectSampleRatioMismatch([
      { weightPct: 50, visits: 510 },
      { weightPct: 50, visits: 490 },
    ])
    expect(result).toBe(false)
  })

  it('returns true when traffic split is far from configured weights', () => {
    const result = detectSampleRatioMismatch([
      { weightPct: 50, visits: 700 },
      { weightPct: 50, visits: 300 },
    ])
    expect(result).toBe(true)
  })

  it('handles uneven configured weights correctly', () => {
    const result = detectSampleRatioMismatch([
      { weightPct: 80, visits: 790 },
      { weightPct: 20, visits: 210 },
    ])
    expect(result).toBe(false)
  })

  it('returns null when there is not enough traffic yet to trust the test', () => {
    const result = detectSampleRatioMismatch([
      { weightPct: 50, visits: 30 },
      { weightPct: 50, visits: 20 },
    ])
    expect(result).toBeNull()
  })

  it('returns null for a single variant', () => {
    expect(detectSampleRatioMismatch([{ weightPct: 100, visits: 500 }])).toBeNull()
  })

  it('works with more than two variants', () => {
    const balanced = detectSampleRatioMismatch([
      { weightPct: 34, visits: 341 },
      { weightPct: 33, visits: 328 },
      { weightPct: 33, visits: 331 },
    ])
    expect(balanced).toBe(false)

    const skewed = detectSampleRatioMismatch([
      { weightPct: 34, visits: 600 },
      { weightPct: 33, visits: 200 },
      { weightPct: 33, visits: 200 },
    ])
    expect(skewed).toBe(true)
  })
})
