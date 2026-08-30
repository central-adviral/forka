import { describe, it, expect } from 'vitest'
import { resolvePeriodSince } from './report-period'

const NOW = new Date('2026-08-30T15:30:00.000Z')

describe('resolvePeriodSince', () => {
  it('returns null for "all" (no filter)', () => {
    expect(resolvePeriodSince('all', NOW)).toBeNull()
  })

  it('returns null when period is undefined', () => {
    expect(resolvePeriodSince(undefined, NOW)).toBeNull()
  })

  it('returns midnight of the current day for "today"', () => {
    const since = resolvePeriodSince('today', NOW)
    expect(since?.getFullYear()).toBe(2026)
    expect(since?.getMonth()).toBe(7)
    expect(since?.getDate()).toBe(30)
    expect(since?.getHours()).toBe(0)
    expect(since?.getMinutes()).toBe(0)
  })

  it('returns 7 days before now for "7d"', () => {
    const since = resolvePeriodSince('7d', NOW)
    expect(since?.getTime()).toBe(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
  })

  it('returns 30 days before now for "30d"', () => {
    const since = resolvePeriodSince('30d', NOW)
    expect(since?.getTime()).toBe(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
  })

  it('returns the first day of the current month for "month"', () => {
    const since = resolvePeriodSince('month', NOW)
    expect(since?.getFullYear()).toBe(2026)
    expect(since?.getMonth()).toBe(7)
    expect(since?.getDate()).toBe(1)
  })
})
