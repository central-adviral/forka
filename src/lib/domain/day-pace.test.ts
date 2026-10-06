import { describe, it, expect } from 'vitest'
import { projectDay } from './day-pace'

describe('projectDay', () => {
  it('carries the sales so far to the end of the São Paulo day', () => {
    // 15:00 UTC = 12:00 in São Paulo, half the day gone.
    expect(projectDay(40, new Date('2026-10-06T15:00:00Z'))).toBe(80)
  })

  it('offers nothing before 06:00 in São Paulo, when the rate is still noise', () => {
    expect(projectDay(3, new Date('2026-10-06T08:00:00Z'))).toBeNull()
  })
})
