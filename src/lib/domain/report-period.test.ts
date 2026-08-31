import { describe, it, expect } from 'vitest'
import { resolvePeriodSince, resolvePeriodUntil, resolveDateRange } from './report-period'

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

  it('returns midnight of the previous day for "yesterday"', () => {
    const since = resolvePeriodSince('yesterday', NOW)
    expect(since?.getFullYear()).toBe(2026)
    expect(since?.getMonth()).toBe(7)
    expect(since?.getDate()).toBe(29)
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

describe('resolvePeriodUntil', () => {
  it('returns midnight of the current day for "yesterday", bounding it to a single day', () => {
    const until = resolvePeriodUntil('yesterday', NOW)
    expect(until?.getFullYear()).toBe(2026)
    expect(until?.getMonth()).toBe(7)
    expect(until?.getDate()).toBe(30)
    expect(until?.getHours()).toBe(0)
  })

  it('returns null for every other period', () => {
    expect(resolvePeriodUntil('today', NOW)).toBeNull()
    expect(resolvePeriodUntil('7d', NOW)).toBeNull()
    expect(resolvePeriodUntil('30d', NOW)).toBeNull()
    expect(resolvePeriodUntil('month', NOW)).toBeNull()
    expect(resolvePeriodUntil('all', NOW)).toBeNull()
    expect(resolvePeriodUntil(undefined, NOW)).toBeNull()
  })
})

describe('resolveDateRange', () => {
  it('spans midnight of "desde" to midnight of the day after "ate"', () => {
    const range = resolveDateRange('2026-08-01', '2026-08-15')
    expect(range?.since.toISOString()).toBe(new Date('2026-08-01T00:00:00').toISOString())
    expect(range?.until.toISOString()).toBe(new Date('2026-08-16T00:00:00').toISOString())
  })

  it('returns null when either date is missing', () => {
    expect(resolveDateRange(undefined, '2026-08-15')).toBeNull()
    expect(resolveDateRange('2026-08-01', undefined)).toBeNull()
    expect(resolveDateRange(undefined, undefined)).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(resolveDateRange('not-a-date', '2026-08-15')).toBeNull()
  })

  it('returns null when "desde" is after "ate" (inverted range)', () => {
    expect(resolveDateRange('2026-08-15', '2026-08-01')).toBeNull()
  })

  it('accepts a single-day range (desde equals ate)', () => {
    const range = resolveDateRange('2026-08-10', '2026-08-10')
    expect(range).not.toBeNull()
    expect(range!.until.getTime() - range!.since.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})
