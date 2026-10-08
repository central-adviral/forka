'use client'

import { useState } from 'react'

interface ProjectOption {
  funnelId: string
  funnelName: string
  rulesHref: string
  resultado: 'compra' | 'lead'
  fronts: { id: string; name: string; rule: string }[]
}

interface MetricOption {
  value: string
  label: string
  projectOnly: boolean
  salesOnly: boolean
}

const isFrontScope = (scope: string) => scope !== '' && !scope.endsWith('|')

// A front's sales are the ones whose UTM ad runs in its campaigns (0086), so CPA geral stays
// project-wide; and a lead project has no sales at all, so it never offers CPA or ROAS. The server action refuses both too;
// this keeps them from being picked in the first place.
export function availableMetrics<T extends MetricOption>(scope: string, metrics: T[], resultado: 'compra' | 'lead' = 'compra'): T[] {
  return metrics.filter((option) => !(isFrontScope(scope) && option.projectOnly) && !(resultado === 'lead' && option.salesOnly))
}

export function ScopeMetricFields({
  projects,
  metrics,
  fieldClass,
  initial,
}: {
  projects: ProjectOption[]
  metrics: MetricOption[]
  fieldClass: string
  /** Prefills an edit; a new watcher starts empty. */
  initial?: { funnelId: string; frontId: string; metric: string }
}) {
  const [funnelId, setFunnelId] = useState(initial?.funnelId ?? (projects.length === 1 ? projects[0].funnelId : ''))
  const [frontId, setFrontId] = useState(initial?.frontId ?? '')
  const [metric, setMetric] = useState(initial?.metric ?? metrics[0]?.value ?? '')
  const project = projects.find((option) => option.funnelId === funnelId)
  const scope = funnelId ? `${funnelId}|${frontId}` : ''
  const available = availableMetrics(scope, metrics, project?.resultado)

  function pick(nextFunnel: string, nextFront: string) {
    setFunnelId(nextFunnel)
    setFrontId(nextFront)
    const offered = availableMetrics(nextFunnel ? `${nextFunnel}|${nextFront}` : '', metrics, projects.find((option) => option.funnelId === nextFunnel)?.resultado)
    if (!offered.some((option) => option.value === metric)) setMetric(offered[0]?.value ?? '')
  }

  return (
    <>
      <input type="hidden" name="scope" value={scope} />
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
        Projeto
        <select required value={funnelId} onChange={(event) => pick(event.target.value, '')} className={fieldClass}>
          <option value="" disabled>
            escolher projeto
          </option>
          {projects.map((option) => (
            <option key={option.funnelId} value={option.funnelId}>
              {option.funnelName}
            </option>
          ))}
        </select>
        {project && (
          <span className="text-[11px]">
            Campanhas do projeto pelas{' '}
            <a href={project.rulesHref} className="text-[var(--ct-accent)] hover:underline">
              Regras de campanha
            </a>
            , as mesmas das Análises.
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
        Frente (opcional)
        <select value={frontId} disabled={!project} onChange={(event) => pick(funnelId, event.target.value)} className={fieldClass}>
          <option value="">todas as frentes · investimento + vendas</option>
          {(project?.fronts ?? []).map((front) => (
            <option key={front.id} value={front.id}>
              {front.name}
              {front.rule ? ` · campanhas com ${front.rule}` : ''}
            </option>
          ))}
        </select>
        <span className="text-[11px]">{frontId ? 'Vendas da frente: as que a UTM liga a um anúncio dela (CPA de anúncio e ROAS).' : 'Com todas as vendas do projeto: vale para CPA e ROAS.'}</span>
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
