export type ReportPeriod = 'today' | '7d' | '30d' | 'month' | 'all'

export const REPORT_PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'all', label: 'Tudo' },
]

const DAY_MS = 24 * 60 * 60 * 1000

export function resolvePeriodSince(period: string | undefined, now: Date = new Date()): Date | null {
  switch (period) {
    case 'today': {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start
    }
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
