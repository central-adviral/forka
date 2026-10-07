import { formatMetric, thresholds, type WatcherMetric, type WatcherStatus } from '@/lib/domain/watchers'

export interface TrailPoint {
  day: string
  value: number | null
  status: WatcherStatus
}

const DOT: Record<WatcherStatus, string> = {
  ok: 'var(--ct-ok)',
  warn: 'var(--ct-warn)',
  crit: 'var(--ct-crit)',
  sem_volume: 'var(--ct-text-3)',
  sem_dado: 'var(--ct-text-3)',
}

// The last closed days of a watcher against its band: target, atenção and crítico as dashed lines,
// each day a dot in the color of the status it got, so a slow drift shows before the alert opens.
export function WatcherTrail({
  points,
  metric,
  target,
  warnPct,
  critPct,
}: {
  points: TrailPoint[]
  metric: WatcherMetric
  target: number
  warnPct: number
  critPct: number
}) {
  const known = points.filter((point): point is TrailPoint & { value: number } => point.value !== null)
  if (known.length === 0) return <span className="text-[11px] text-[var(--ct-text-3)]">sem dado nos últimos {points.length} dias</span>
  const band = thresholds(metric, target, warnPct, critPct)
  const W = 280
  const H = 64
  const pad = 6
  const values = [...known.map((point) => point.value), target, band.warn, band.crit]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => pad + (i / Math.max(points.length - 1, 1)) * (W - pad * 2)
  const y = (value: number) => H - pad - ((value - min) / span) * (H - pad * 2)
  let path = ''
  let open = false
  points.forEach((point, i) => {
    if (point.value === null) {
      open = false
      return
    }
    path += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(point.value).toFixed(1)} `
    open = true
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-[280px] flex-none" role="img" aria-label={`Últimos ${points.length} dias contra a faixa`}>
      {[
        { value: target, color: 'var(--ct-ok)' },
        { value: band.warn, color: 'var(--ct-warn)' },
        { value: band.crit, color: 'var(--ct-crit)' },
      ].map((line) => (
        <line key={line.color} x1={pad} x2={W - pad} y1={y(line.value)} y2={y(line.value)} strokeDasharray="3 4" style={{ stroke: line.color, opacity: 0.6 }} />
      ))}
      <path d={path} fill="none" strokeWidth={1.5} style={{ stroke: 'var(--ct-text-2)' }} />
      {points.map((point, i) =>
        point.value === null ? null : (
          <circle key={point.day} cx={x(i)} cy={y(point.value)} r={2.8} style={{ fill: DOT[point.status] }}>
            <title>{`${point.day.slice(8, 10)}/${point.day.slice(5, 7)} · ${formatMetric(metric, point.value)}`}</title>
          </circle>
        )
      )}
    </svg>
  )
}
