'use client'

import { useState } from 'react'

export interface ScopeOption {
  /** 'funil', 'etapa:<id>' or 'frente:<id>', as the watcher actions read it. */
  value: string
  label: string
}

export interface MetricOption {
  value: string
  label: string
  projectOnly: boolean
  salesOnly: boolean
}

const kindOf = (scope: string) => (scope.startsWith('frente:') ? 'frente' : scope.startsWith('etapa:') ? 'etapa' : 'funil')

// A front's sales are the ones whose UTM ad runs in its campaigns (0086), so CPA geral is of the
// funnel or of a stage (whose sales the stage counts, 0106); CPA de anúncio is of a front. A funnel
// whose result counts no sales never offers CPA or ROAS. The server actions refuse these too; this
// keeps them from being picked in the first place.
export function availableMetrics<T extends MetricOption>(scope: string, metrics: T[], sales = true): T[] {
  const kind = kindOf(scope)
  return metrics.filter(
    (option) => !(kind === 'frente' && option.projectOnly) && !(kind === 'etapa' && option.value === 'cpa_anuncio') && !(!sales && option.salesOnly)
  )
}

export function ScopeMetricFields({
  scopes,
  metrics,
  sales,
  fieldClass,
  initial,
}: {
  scopes: ScopeOption[]
  metrics: MetricOption[]
  /** Whether the funnel's result counts sales. */
  sales: boolean
  fieldClass: string
  /** Prefills an edit; a new watcher starts on the whole funnel. */
  initial?: { scope: string; metric: string }
}) {
  const [scope, setScope] = useState(initial?.scope ?? 'funil')
  const [metric, setMetric] = useState(initial?.metric ?? metrics[0]?.value ?? '')
  const available = availableMetrics(scope, metrics, sales)

  function pick(next: string) {
    setScope(next)
    const offered = availableMetrics(next, metrics, sales)
    if (!offered.some((option) => option.value === metric)) setMetric(offered[0]?.value ?? '')
  }

  return (
    <>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
        Olha
        <select name="scope" required value={scope} onChange={(event) => pick(event.target.value)} className={fieldClass}>
          {scopes.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-[11px]">
          {kindOf(scope) === 'frente'
            ? 'Só as campanhas da frente; vendas que a UTM liga a um anúncio dela.'
            : kindOf(scope) === 'etapa'
              ? 'Só as campanhas e as vendas da etapa, os números do card dela.'
              : 'Todas as campanhas e vendas do funil.'}
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Métrica
        <select name="metric" required value={metric} onChange={(event) => setMetric(event.target.value)} className={fieldClass}>
          {available.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
