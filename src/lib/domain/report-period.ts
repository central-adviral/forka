export type ReportPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all'

export const REPORT_PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'all', label: 'Tudo' },
]

const DAY_MS = 24 * 60 * 60 * 1000

// Every period in this file is a BRAZILIAN calendar day, never the server's. On Vercel the server
// runs in UTC, so setHours(0,0,0,0) made "Hoje" start at 21:00 of the previous day for the
// operator, and a report opened between 21:00 and midnight already showed tomorrow's date.
//
// Brazil has had no DST since 2019, so BRT is a fixed UTC-3 offset and a BRT calendar day always
// begins at this same UTC instant. Same convention funnel-repo has always used for data_venda.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

export function brtDayBoundaryUtc(dateOnly: string): string {
  return `${dateOnly}T03:00:00.000Z`
}

/** The BRT calendar date the instant falls on, as "YYYY-MM-DD". */
function toDateOnly(date: Date): string {
  return new Date(date.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

/** Midnight in Brazil for the BRT day the instant falls on, as the UTC instant it really is. */
function startOfDay(date: Date): Date {
  return new Date(brtDayBoundaryUtc(toDateOnly(date)))
}

export function resolvePeriodSince(period: string | undefined, now: Date = new Date()): Date | null {
  switch (period) {
    case 'today':
      return startOfDay(now)
    case 'yesterday':
      return new Date(startOfDay(now).getTime() - DAY_MS)
    // N calendar days counting today, like the Hoje page: "7 dias" never spans eight dates.
    case '7d':
      return new Date(startOfDay(now).getTime() - 6 * DAY_MS)
    case '30d':
      return new Date(startOfDay(now).getTime() - 29 * DAY_MS)
    case 'month':
      return new Date(brtDayBoundaryUtc(`${toDateOnly(now).slice(0, 7)}-01`))
    default:
      return null
  }
}

export function resolvePeriodUntil(period: string | undefined, now: Date = new Date()): Date | null {
  return period === 'yesterday' ? startOfDay(now) : null
}

export function resolveDateRange(desde: string | undefined, ate: string | undefined): { since: Date; until: Date } | null {
  if (!desde || !ate) return null
  // The operator typed Brazilian calendar days; without the offset these parsed in the server's
  // zone, which on Vercel means the range starts and ends three hours early.
  const since = new Date(brtDayBoundaryUtc(desde))
  const ateStart = new Date(brtDayBoundaryUtc(ate))
  if (Number.isNaN(since.getTime()) || Number.isNaN(ateStart.getTime())) return null
  const until = new Date(ateStart.getTime() + DAY_MS)
  if (since.getTime() >= until.getTime()) return null
  return { since, until }
}

export function formatBr(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

const ALL_TIME_SINCE = '2020-01-01'

// Same period vocabulary as resolvePeriodSince/resolvePeriodUntil, but returns plain
// "YYYY-MM-DD" bounds (no unbounded null) for repos that query a `date` column directly,
// like funnel-repo's daily aggregates. "all"/unset resolves to a fixed early sentinel date
// rather than an open-ended lower bound, since these queries require a concrete value.
export function resolvePeriodDateRange(
  periodo: string | undefined,
  desde: string | undefined,
  ate: string | undefined,
  now: Date = new Date()
): { since: string; until: string } {
  const tomorrow = toDateOnly(new Date(now.getTime() + DAY_MS))
  if (periodo === 'custom') {
    const range = resolveDateRange(desde, ate)
    if (range) return { since: toDateOnly(range.since), until: toDateOnly(range.until) }
  }
  const sinceDate = resolvePeriodSince(periodo, now)
  const untilDate = resolvePeriodUntil(periodo, now)
  return {
    since: sinceDate ? toDateOnly(sinceDate) : ALL_TIME_SINCE,
    until: untilDate ? toDateOnly(untilDate) : tomorrow,
  }
}

// A test created minutes ago has been running for "1 dia", not zero -- the summary bar reads
// as elapsed calendar days and never shows a bare 0.
export function daysRunningSince(createdAtIso: string, now: Date = new Date()): number {
  const created = new Date(createdAtIso).getTime()
  if (Number.isNaN(created)) return 1
  return Math.max(1, Math.ceil((now.getTime() - created) / DAY_MS))
}

// The window to compare against: same duration as the current one, ending where it begins.
//
// Equal duration rather than the calendar equivalent, deliberately. On the 8th, "Este mês" holds
// 8 elapsed days; comparing it against a full 31-day month would report a collapse that never
// happened. An open-ended `until` means the window runs to now, so "7 dias" compares against the
// 7 before it. A null `since` is "Tudo", which has no before -- returning null there keeps the
// report from inventing a baseline.
export function resolvePreviousWindow(
  since: Date | null,
  until: Date | null,
  now: Date = new Date()
): { since: Date; until: Date } | null {
  if (!since) return null
  const currentEnd = until ?? now
  const duration = currentEnd.getTime() - since.getTime()
  if (!(duration > 0)) return null
  return { since: new Date(since.getTime() - duration), until: new Date(since.getTime()) }
}
