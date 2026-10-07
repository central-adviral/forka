import { describe, it, expect } from 'vitest'
import { pickVariant } from './pick-variant'

describe('pickVariant', () => {
  const variants = [
    { id: 'a', weightPct: 50 },
    { id: 'b', weightPct: 30 },
    { id: 'c', weightPct: 20 },
  ]

  it('picks the first variant when rand is near 0', () => {
    expect(pickVariant(variants, () => 0)).toBe('a')
  })

  it('picks the boundary correctly at 50%', () => {
    expect(pickVariant(variants, () => 0.49)).toBe('a')
    expect(pickVariant(variants, () => 0.51)).toBe('b')
  })

  it('picks the last variant when rand is near 1', () => {
    expect(pickVariant(variants, () => 0.99)).toBe('c')
  })

  it('throws on empty variant list', () => {
    expect(() => pickVariant([], () => 0.5)).toThrow()
  })

  it('distributes proportionally to weights over many samples', () => {
    function mulberry32(seed: number) {
      return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const rand = mulberry32(42)
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 10000; i++) {
      counts[pickVariant(variants, rand)]++
    }
    expect(counts.a / 10000).toBeCloseTo(0.5, 1)
    expect(counts.b / 10000).toBeCloseTo(0.3, 1)
    expect(counts.c / 10000).toBeCloseTo(0.2, 1)
  })

  it('never picks a variant parked at weight 0, even when the draw lands on the very end', () => {
    const variants = [
      { id: 'a', weightPct: 100 },
      { id: 'parked', weightPct: 0 },
    ]
    expect(pickVariant(variants, () => 0)).toBe('a')
    expect(pickVariant(variants, () => 0.999999)).toBe('a')
    expect(pickVariant(variants, () => 1)).toBe('a')
  })
})
