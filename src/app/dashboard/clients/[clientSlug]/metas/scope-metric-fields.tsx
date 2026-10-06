'use client'

import { useState } from 'react'

interface ScopeGroup {
  funnelId: string
  funnelName: string
  fronts: { id: string; label: string }[]
}

interface MetricOption {
  value: string
  label: string
  projectOnly: boolean
}

const isFrontScope = (scope: string) => scope !== '' && !scope.endsWith('|')

// Sales belong to the project, not to a front, so a front only offers the media metrics. The
// server action refuses the combination too; this keeps it from being picked in the first place.
export function availableMetrics<T extends MetricOption>(scope: string, metrics: T[]): T[] {
  return isFrontScope(scope) ? metrics.filter((option) => !option.projectOnly) : metrics
}

export function ScopeMetricFields({ groups, metrics, fieldClass }: { groups: ScopeGroup[]; metrics: MetricOption[]; fieldClass: string }) {
  const [scope, setScope] = useState('')
  const [metric, setMetric] = useState(metrics[0]?.value ?? '')
  const isFront = isFrontScope(scope)
  const available = availableMetrics(scope, metrics)

  function pickScope(next: string) {
    setScope(next)
    const offered = availableMetrics(next, metrics)
    if (!offered.some((option) => option.value === metric)) setMetric(offered[0]?.value ?? '')
  }

  return (
    <>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
        Aplica em
        <select name="scope" required value={scope} onChange={(event) => pickScope(event.target.value)} className={fieldClass}>
          <option value="" disabled>
            escolher projeto ou frente
          </option>
          {groups.map((group) => (
            <optgroup key={group.funnelId} label={group.funnelName}>
              <option value={`${group.funnelId}|`}>{group.funnelName} inteiro · investimento + vendas (use para CPA)</option>
              {group.fronts.map((front) => (
                <option key={front.id} value={`${group.funnelId}|${front.id}`}>
                  {front.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Métrica
        <select name="metric" required value={metric} onChange={(event) => setMetric(event.target.value)} className={fieldClass}>
          {available.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.projectOnly ? ' (projeto)' : ''}
            </option>
          ))}
        </select>
        {isFront && <span className="text-[11px] text-[var(--ct-text-3)]">CPA não aparece em frente: as vendas são do projeto.</span>}
      </label>
    </>
  )
}
