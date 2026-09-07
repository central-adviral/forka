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

function startOfDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

export function resolvePeriodSince(period: string | undefined, now: Date = new Date()): Date | null {
  switch (period) {
    case 'today':
      return startOfDay(now)
    case 'yesterday':
      return new Date(startOfDay(now).getTime() - DAY_MS)
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS)
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS)
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    default:
      return null
  }
}

export function resolvePeriodUntil(period: string | undefined, now: Date = new Date()): Date | null {
  return period === 'yesterday' ? startOfDay(now) : null
}

export function resolveDateRange(desde: string | undefined, ate: string | undefined): { since: Date; until: Date } | null {
  if (!desde || !ate) return null
  const since = new Date(`${desde}T00:00:00`)
  const ateStart = new Date(`${ate}T00:00:00`)
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

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

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
