import { describe, it, expect } from 'vitest'
import { resolvePeriodSince, resolvePeriodUntil, resolveDateRange, resolvePeriodDateRange, resolvePreviousWindow, formatBr, daysRunningSince } from './report-period'

const NOW = new Date('2026-08-30T15:30:00.000Z')

describe('resolvePeriodSince', () => {
  it('returns null for "all" (no filter)', () => {
    expect(resolvePeriodSince('all', NOW)).toBeNull()
  })

  it('returns null when period is undefined', () => {
    expect(resolvePeriodSince(undefined, NOW)).toBeNull()
  })

  // Asserted as absolute instants, never as getHours() on the running machine: the bug this pins
  // is precisely the code reading the server's calendar instead of Brazil's, and a relative
  // assertion shifts along with it and stays green. 03:00Z is midnight in Brazil.
  it('returns Brazilian midnight of the current day for "today"', () => {
    expect(resolvePeriodSince('today', NOW)?.toISOString()).toBe('2026-08-30T03:00:00.000Z')
  })

  it('still resolves to the Brazilian day when UTC has already rolled over', () => {
    // 00:30 UTC on the 31st is still 21:30 on the 30th in Brazil, so "Hoje" is the 30th.
    const lateNight = new Date('2026-08-31T00:30:00.000Z')
    expect(resolvePeriodSince('today', lateNight)?.toISOString()).toBe('2026-08-30T03:00:00.000Z')
  })

  it('returns Brazilian midnight of the previous day for "yesterday"', () => {
    expect(resolvePeriodSince('yesterday', NOW)?.toISOString()).toBe('2026-08-29T03:00:00.000Z')
  })

  it('returns 7 days before now for "7d"', () => {
    const since = resolvePeriodSince('7d', NOW)
    expect(since?.getTime()).toBe(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
  })

  it('returns 30 days before now for "30d"', () => {
    const since = resolvePeriodSince('30d', NOW)
    expect(since?.getTime()).toBe(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
  })

  it('returns the first Brazilian day of the current month for "month"', () => {
    expect(resolvePeriodSince('month', NOW)?.toISOString()).toBe('2026-08-01T03:00:00.000Z')
  })

  it('picks the month by the Brazilian date, not the UTC one', () => {
    // 01:00 UTC on 1 September is still 22:00 on 31 August in Brazil, so the month is August.
    const turnOfMonth = new Date('2026-09-01T01:00:00.000Z')
    expect(resolvePeriodSince('month', turnOfMonth)?.toISOString()).toBe('2026-08-01T03:00:00.000Z')
  })
})

describe('resolvePeriodUntil', () => {
  it('returns Brazilian midnight of the current day for "yesterday", bounding it to a single day', () => {
    expect(resolvePeriodUntil('yesterday', NOW)?.toISOString()).toBe('2026-08-30T03:00:00.000Z')
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
  it('spans Brazilian midnight of "desde" to Brazilian midnight of the day after "ate"', () => {
    // The operator typed Brazilian calendar days; the bounds must be those days, not the
    // server's. Absolute instants again, so the assertion cannot drift with the machine.
    const range = resolveDateRange('2026-08-01', '2026-08-15')
    expect(range?.since.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(range?.until.toISOString()).toBe('2026-08-16T03:00:00.000Z')
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

describe('resolvePeriodDateRange', () => {
  it('resolves "7d" to a plain date-only since/until pair, until being tomorrow', () => {
    const { since, until } = resolvePeriodDateRange('7d', undefined, undefined, NOW)
    expect(since).toBe('2026-08-23')
    expect(until).toBe('2026-08-31')
  })

  it('falls back to a fixed early sentinel date for "all" or unset, since these queries need a concrete bound', () => {
    expect(resolvePeriodDateRange('all', undefined, undefined, NOW).since).toBe('2020-01-01')
    expect(resolvePeriodDateRange(undefined, undefined, undefined, NOW).since).toBe('2020-01-01')
  })

  it('resolves "custom" using the desde/ate pair when both are present', () => {
    const { since, until } = resolvePeriodDateRange('custom', '2026-08-01', '2026-08-15', NOW)
    expect(since).toBe('2026-08-01')
    expect(until).toBe('2026-08-16')
  })

  it('falls back to the default range when "custom" is missing desde/ate', () => {
    const { since, until } = resolvePeriodDateRange('custom', undefined, undefined, NOW)
    expect(since).toBe('2020-01-01')
    expect(until).toBe('2026-08-31')
  })
})

describe('formatBr', () => {
  it('formats an ISO date-only string as DD/MM', () => {
    expect(formatBr('2026-08-05')).toBe('05/08')
  })
})

describe('daysRunningSince', () => {
  const now = new Date('2026-09-07T12:00:00.000Z')

  it('counts elapsed days since the test was created', () => {
    expect(daysRunningSince('2026-09-01T12:00:00.000Z', now)).toBe(6)
  })

  it('reports 1 for a test created minutes ago instead of 0', () => {
    expect(daysRunningSince('2026-09-07T11:30:00.000Z', now)).toBe(1)
  })

  it('falls back to 1 when the date is unusable', () => {
    expect(daysRunningSince('not-a-date', now)).toBe(1)
  })
})

// The comparison window has the same duration as the current one and ends where it begins.
// A calendar-aligned rule would compare 8 elapsed days of "Este mês" against a full 31-day
// month and invent a collapse; equal duration never does.
describe('resolvePreviousWindow', () => {
  // A Tuesday, 15:00 in Brazil.
  const now = new Date('2026-09-08T18:00:00.000Z')

  it('shifts a 7-day window back by exactly 7 days', () => {
    const since = resolvePeriodSince('7d', now)!
    const previous = resolvePreviousWindow(since, resolvePeriodUntil('7d', now), now)!
    expect(previous.until.toISOString()).toBe(since.toISOString())
    expect(previous.since.toISOString()).toBe(new Date(since.getTime() - 7 * 86400000).toISOString())
  })

  it('compares today against yesterday, on Brazilian calendar days', () => {
    const since = resolvePeriodSince('today', now)!
    const previous = resolvePreviousWindow(since, resolvePeriodUntil('today', now), now)!
    // "Hoje" runs from midnight in Brazil to now, so the window before it is the same span
    // ending at that midnight -- never the server's midnight.
    expect(previous.until.toISOString()).toBe('2026-09-08T03:00:00.000Z')
    expect(previous.since.getTime()).toBeLessThan(previous.until.getTime())
  })

  it('gives yesterday a full previous day', () => {
    const since = resolvePeriodSince('yesterday', now)!
    const until = resolvePeriodUntil('yesterday', now)!
    const previous = resolvePreviousWindow(since, until, now)!
    expect(previous.until.toISOString()).toBe(since.toISOString())
    expect(previous.until.getTime() - previous.since.getTime()).toBe(86400000)
  })

  it('compares a partial month against the same number of elapsed days, not a full month', () => {
    const since = resolvePeriodSince('month', now)!
    const previous = resolvePreviousWindow(since, resolvePeriodUntil('month', now), now)!
    const elapsed = now.getTime() - since.getTime()
    expect(previous.until.getTime() - previous.since.getTime()).toBe(elapsed)
    expect(previous.until.toISOString()).toBe(since.toISOString())
  })

  it('mirrors a custom range onto the span immediately before it', () => {
    const range = resolveDateRange('2026-09-01', '2026-09-07')!
    const previous = resolvePreviousWindow(range.since, range.until, now)!
    expect(previous.until.toISOString()).toBe(range.since.toISOString())
    expect(previous.until.getTime() - previous.since.getTime()).toBe(
      range.until.getTime() - range.since.getTime()
    )
  })

  // "Tudo" has no before. Offering a comparison there would invent a baseline out of nothing.
  it('returns null when the current window has no lower bound', () => {
    expect(resolvePreviousWindow(null, null, now)).toBeNull()
  })

  it('returns null for a window that ends before it starts', () => {
    const since = new Date('2026-09-08T00:00:00.000Z')
    const until = new Date('2026-09-07T00:00:00.000Z')
    expect(resolvePreviousWindow(since, until, now)).toBeNull()
  })
})
