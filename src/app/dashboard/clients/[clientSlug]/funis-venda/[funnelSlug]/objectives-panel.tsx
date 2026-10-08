import { PROJECT_RESULTS, formatResult, meetsTarget, resultValue, type ProjectResult, type ResultInputs } from '@/lib/domain/project-plan'

// Visão geral (0102): the project's principal and secondary metric against their targets, and the
// same for each front, by its own metrics or by the project's ("segue o projeto"). Every other
// metric of the funnel stays in the other tabs.

export interface ObjectiveMetric {
  metric: ProjectResult
  target: number | null
}

export interface ObjectiveFront {
  id: string
  code: string
  name: string
  /** Own metrics; null follows the project and has no alert of its own. */
  own: { primary: ObjectiveMetric; secondary: ObjectiveMetric | null } | null
  inputs: ResultInputs
}

const mono = 'font-[family-name:var(--font-geist-mono)]'

function Kpi({ role, metric, target, inputs, big }: ObjectiveMetric & { role: string; inputs: ResultInputs; big?: boolean }) {
  const value = resultValue(metric, inputs)
  const good = meetsTarget(metric, value, target)
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] ${big ? 'p-4' : 'p-3'}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">{role}</span>
      <span className="flex flex-wrap items-baseline gap-2">
        <b className={`${mono} tabular-nums ${big ? 'text-[26px]' : 'text-[19px]'}`}>{formatResult(metric, value)}</b>
        <span className="text-[13px] text-[var(--ct-text-2)]">{PROJECT_RESULTS[metric].cost}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-[var(--ct-text-3)]">{target ? `alvo ${PROJECT_RESULTS[metric].higherIsBetter ? '≥' : '≤'} ${formatResult(metric, target)}` : 'sem alvo'}</span>
        {good !== null && (
          <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${good ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]'}`}>
            {good ? 'na meta' : 'fora da meta'}
          </span>
        )}
      </span>
    </div>
  )
}

export function ObjectivesPanel({ primary, secondary, inputs, fronts }: { primary: ObjectiveMetric; secondary: ObjectiveMetric | null; inputs: ResultInputs; fronts: ObjectiveFront[] }) {
  return (
    <section aria-label="Métricas do projeto" className="mb-6 flex flex-col gap-3">
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <Kpi role="Principal do projeto" {...primary} inputs={inputs} big />
        {secondary && <Kpi role="Secundária do projeto" {...secondary} inputs={inputs} big />}
      </div>
      {fronts.length > 0 && (
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {fronts.map((front) => (
            <div key={front.id} className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-3">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-[13.5px]">
                  <span className={`${mono} mr-1.5 rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px]`}>{front.code}</span>
                  {front.name}
                </b>
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${front.own ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-accent)]' : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]'}`}>
                  {front.own ? 'métricas próprias' : 'segue o projeto'}
                </span>
              </span>
              {front.own ? (
                <>
                  <Kpi role="Principal da frente" {...front.own.primary} inputs={front.inputs} />
                  {front.own.secondary && <Kpi role="Secundária da frente" {...front.own.secondary} inputs={front.inputs} />}
                </>
              ) : (
                <span className="flex flex-wrap gap-4 text-[13.5px]">
                  {[primary, secondary].filter((item): item is ObjectiveMetric => item !== null).map((item) => (
                    <span key={item.metric}>
                      {PROJECT_RESULTS[item.metric].cost} <b className={`${mono} tabular-nums`}>{formatResult(item.metric, resultValue(item.metric, front.inputs))}</b>
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
