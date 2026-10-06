import { describe, it, expect } from 'vitest'
import { testLeader } from './test-leader'

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

describe('testLeader', () => {
  it('names the challenger that clearly beats the control', () => {
    const leader = testLeader(
      [
        { variant_id: 'a', variant_name: 'Controle', visits: 1000, conversions: 50 },
        { variant_id: 'b', variant_name: 'Nova headline', visits: 1000, conversions: 90 },
      ],
      'a',
      seeded(3)
    )
    expect(leader?.name).toBe('Nova headline')
    expect(leader!.confidencePct).toBeGreaterThan(95)
  })

  it('keeps the control as leader when no challenger beats it', () => {
    const leader = testLeader(
      [
        { variant_id: 'a', variant_name: 'Controle', visits: 1000, conversions: 90 },
        { variant_id: 'b', variant_name: 'Nova headline', visits: 1000, conversions: 50 },
      ],
      'a',
      seeded(3)
    )
    expect(leader?.name).toBe('Controle')
  })

  it('has no leader before any visit', () => {
    expect(testLeader([{ variant_id: 'a', variant_name: 'Controle', visits: 0, conversions: 0 }], 'a')).toBeNull()
  })
})
