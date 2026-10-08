import type { DailyChancePoint } from '@/lib/domain/daily-chance'

// "Chance de vencer, dia a dia": one line per challenger and the rule's bar dashed across. Plain
// SVG on the server: the report already renders there, and a line chart needs no library.

const W = 640
const H = 180
const PAD = { left: 34, right: 12, top: 12, bottom: 24 }
const COLORS = ['var(--ct-ab)', 'var(--ct-an)', 'var(--ct-warn)', 'var(--ct-painel)', 'var(--ct-ok)']

export function ChanceChart({ points, series, bar }: { points: DailyChancePoint[]; series: { id: string; name: string }[]; bar: number }) {
  if (points.length < 2) {
    return <p className="text-[12.5px] text-[var(--ct-text-3)]">O gráfico aparece a partir do segundo dia com pessoas no teste.</p>
  }
  const x = (index: number) => PAD.left + (index / (points.length - 1)) * (W - PAD.left - PAD.right)
  const y = (pct: number) => PAD.top + (1 - pct / 100) * (H - PAD.top - PAD.bottom)
  const label = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1]

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-[220px] w-full" role="img" aria-label="Chance de vencer, dia a dia">
        {[0, 50, 100].map((pct) => (
          <g key={pct}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(pct)} y2={y(pct)} stroke="var(--ct-line)" />
            <text x={PAD.left - 6} y={y(pct) + 4} textAnchor="end" fontSize="10" fill="var(--ct-text-3)">
              {pct}%
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(bar)} y2={y(bar)} stroke="var(--ct-ok)" strokeDasharray="5 5" />
        <text x={W - PAD.right} y={y(bar) - 4} textAnchor="end" fontSize="10" fill="var(--ct-ok)">
          a regra ({bar}%)
        </text>
        {series.map((variant, index) => {
          const path = points
            .map((point, pointIndex) => (point.chances[variant.id] == null ? null : `${x(pointIndex)},${y(point.chances[variant.id]!)}`))
            .filter(Boolean)
            .join(' ')
          return path ? <polyline key={variant.id} points={path} fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="2.5" strokeLinejoin="round" /> : null
        })}
        {ticks.map((index) => (
          <text key={index} x={x(index)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ct-text-3)">
            {label(points[index].day)}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 text-[12px] text-[var(--ct-text-2)]">
        {series.map((variant, index) => (
          <span key={variant.id} className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
            {variant.name}
          </span>
        ))}
      </div>
    </div>
  )
}
