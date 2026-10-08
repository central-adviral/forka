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

  it('leaves weight-0 variants out of the check, their visits and their degree of freedom', () => {
    // 50/50 between the live variants; the paused one kept old visits from before its weight went to 0.
    expect(
      detectSampleRatioMismatch([
        { weightPct: 50, visits: 505 },
        { weightPct: 50, visits: 495 },
        { weightPct: 0, visits: 400 },
      ])
    ).toBe(false)
    // 40/40 after a third variant (20%) was paused: the live split is still even.
    expect(
      detectSampleRatioMismatch([
        { weightPct: 40, visits: 498 },
        { weightPct: 40, visits: 502 },
        { weightPct: 0, visits: 250 },
      ])
    ).toBe(false)
    // Only one live variant left: nothing to compare.
    expect(detectSampleRatioMismatch([{ weightPct: 100, visits: 900 }, { weightPct: 0, visits: 300 }])).toBeNull()
  })
})
