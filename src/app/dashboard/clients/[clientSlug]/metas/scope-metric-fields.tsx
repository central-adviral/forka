'use client'

import { useState } from 'react'

interface ProjectOption {
  funnelId: string
  funnelName: string
  rulesHref: string
  fronts: { id: string; name: string; rule: string }[]
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

export function ScopeMetricFields({ projects, metrics, fieldClass }: { projects: ProjectOption[]; metrics: MetricOption[]; fieldClass: string }) {
  const [funnelId, setFunnelId] = useState(projects.length === 1 ? projects[0].funnelId : '')
  const [frontId, setFrontId] = useState('')
  const [metric, setMetric] = useState(metrics[0]?.value ?? '')
  const project = projects.find((option) => option.funnelId === funnelId)
  const scope = funnelId ? `${funnelId}|${frontId}` : ''
  const available = availableMetrics(scope, metrics)

  function pick(nextFunnel: string, nextFront: string) {
    setFunnelId(nextFunnel)
    setFrontId(nextFront)
    const offered = availableMetrics(nextFunnel ? `${nextFunnel}|${nextFront}` : '', metrics)
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
        <span className="text-[11px]">{frontId ? 'Só mídia: as vendas são do projeto, não de uma frente.' : 'Com vendas: vale para CPA.'}</span>
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
