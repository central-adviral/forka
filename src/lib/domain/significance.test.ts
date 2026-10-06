import { describe, it, expect } from 'vitest'
import { probabilityToBeatControl } from './significance'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('probabilityToBeatControl', () => {
  it('returns close to 0.5 when control and variant perform identically', () => {
    const rand = mulberry32(1)
    const p = probabilityToBeatControl({ visits: 500, conversions: 50 }, { visits: 500, conversions: 50 }, rand, 5000)
    expect(p).toBeGreaterThan(0.3)
    expect(p).toBeLessThan(0.7)
  })

  it('returns high confidence when the variant clearly outperforms', () => {
    const rand = mulberry32(2)
    const p = probabilityToBeatControl({ visits: 1000, conversions: 50 }, { visits: 1000, conversions: 150 }, rand, 5000)
    expect(p).toBeGreaterThan(0.9)
  })

  it('returns low confidence when the variant clearly underperforms', () => {
    const rand = mulberry32(3)
    const p = probabilityToBeatControl({ visits: 1000, conversions: 150 }, { visits: 1000, conversions: 50 }, rand, 5000)
    expect(p).toBeLessThan(0.1)
  })

  it('returns null for zero-visit variants instead of a meaningless probability', () => {
    const rand = mulberry32(4)
    const p = probabilityToBeatControl({ visits: 0, conversions: 0 }, { visits: 0, conversions: 0 }, rand, 1000)
    expect(p).toBeNull()
  })

  it('does not read a control with more conversions than visits as a certain win (0050)', () => {
    // 12 conversions on 10 visits used to turn the control's rate into exactly 100% on every draw,
    // so a close variant scored 0% to beat it.
    const rand = mulberry32(7)
    const p = probabilityToBeatControl({ visits: 10, conversions: 12 }, { visits: 10, conversions: 9 }, rand, 5000)
    expect(p).not.toBeNull()
    expect(Number.isNaN(p)).toBe(false)
    expect(p!).toBeGreaterThan(0.05)
  })
})
