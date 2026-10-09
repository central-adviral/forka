'use client'

import { useActionState, useState } from 'react'
import { MEASURES, STAGE_MEASURES, funnelResultStage, type StageMeasure } from '@/lib/domain/funnel-stages'
import { MEASURE_COLOR, cleanTag } from '@/lib/domain/stage-canvas'
import { MAX_PLANNED_STAGES, moveItem, orderPlanned, plannedStagesIssues, type FunnelModelKey, type PlannedStage, type StageDraft } from '@/lib/domain/new-funnel'
import { createFunnel, type NewFunnelState } from './actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'min-h-11 w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)] disabled:opacity-60'
const smallField =
  'min-h-9 w-full min-w-0 rounded-[9px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const iconButton =
  'grid h-9 w-9 flex-none place-items-center rounded-[9px] border border-[var(--ct-line-2)] text-[13px] text-[var(--ct-text-2)] hover:border-[var(--ct-text-3)] hover:text-[var(--ct-text)] disabled:opacity-35'
const label = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[var(--ct-text-2)]'

type Row = StageDraft & { key: string }

// React keys only (never rendered), so the server and the browser counting apart is harmless.
let rowSeq = 0
const keyed = (stages: StageDraft[]): Row[] => stages.map(({ name, tag, measure, parallel }) => ({ name, tag, measure, parallel, key: String(rowSeq++) }))

export function NewFunnelForm({
  context,
  models,
  funnels,
  presets,
}: {
  context: { client_id: string; client_slug: string }
  models: { key: FunnelModelKey; name: string; text: string; stages: PlannedStage[] }[]
  funnels: { id: string; name: string }[]
  presets: StageDraft[]
}) {
  const [state, submit, pending] = useActionState<NewFunnelState, FormData>(createFunnel.bind(null, context), { error: null })
  const [tag, setTag] = useState('')
  const [model, setModel] = useState<FunnelModelKey>(models[0].key)
  const [rows, setRows] = useState<Row[]>(() => keyed(models[0].stages))
  const [edited, setEdited] = useState(false)
  const [source, setSource] = useState('')
  const issues = source ? [] : plannedStagesIssues(rows)

  function pick(key: FunnelModelKey) {
    setModel(key)
    setRows(keyed(models.find((option) => option.key === key)?.stages ?? []))
    setEdited(false)
  }

  function edit(next: Row[]) {
    setRows(next)
    setEdited(true)
  }

  const patch = (index: number, change: Partial<StageDraft>) => edit(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))

  return (
    <form action={submit} className="card-shadow flex flex-col gap-5 rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-6 sm:px-6">
      <div className="grid gap-4 md:grid-cols-3">
        <label className={label}>
          Nome do funil
          <input name="name" required maxLength={80} placeholder="ex.: Lançamento Mentoria Nov/26" className={field} />
        </label>
        <label className={label}>
          Etiqueta do funil
          <input
            name="tag"
            value={tag}
            maxLength={24}
            spellCheck={false}
            placeholder="ex.: MENT26"
            aria-describedby="new-funnel-tag-hint"
            onChange={(event) => setTag(cleanTag(event.target.value) ?? '')}
            className={`${field} ${mono}`}
          />
        </label>
        <label className={label}>
          Ou duplicar um funil anterior
          <select name="duplicate_from" value={source} onChange={(event) => setSource(event.target.value)} className={field}>
            <option value="">Não duplicar</option>
            {funnels.map((funnel) => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id="new-funnel-tag-hint" className="-mt-2 text-[12.5px] text-[var(--ct-text-3)]">
        A etiqueta do funil vai no nome de toda campanha dele e evita que dois funis do mesmo cliente disputem a mesma campanha. Opcional; dá para pôr depois.
      </p>

      <fieldset disabled={source !== ''} className="flex flex-col gap-2.5 disabled:opacity-50">
        <legend className="mb-2.5 text-[14px] font-semibold">Modelo {source !== '' && <span className="text-[12.5px] font-normal text-[var(--ct-text-3)]">· o funil duplicado traz as etapas dele</span>}</legend>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {models.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] px-4 py-3.5 hover:border-[var(--ct-line-2)] has-[:checked]:border-[var(--ct-accent)] has-[:checked]:bg-[var(--ct-accent-soft)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ct-accent)]"
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="model" value={option.key} checked={model === option.key} onChange={() => pick(option.key)} className="sr-only" />
                <b className="text-[14.5px] font-semibold">{model === option.key && edited && option.key !== 'do_zero' ? `Personalizado (a partir de ${option.name})` : option.name}</b>
              </span>
              <span className="text-[12.5px] text-[var(--ct-text-2)]">{option.text}</span>
              <StageChips stages={option.stages} />
            </label>
          ))}
        </div>
      </fieldset>

      {source === '' && (
        <section aria-labelledby="new-funnel-stages" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="new-funnel-stages" className="text-[14px] font-semibold">
              Etapas que o funil vai ter
            </h2>
            <span className="text-[12.5px] text-[var(--ct-text-3)]">
              {rows.length} de até {MAX_PLANNED_STAGES} · cada uma nasce com uma frente
            </span>
          </div>
          <input type="hidden" name="stages" value={JSON.stringify(rows.map(({ name, tag: stageTag, measure, parallel }) => ({ name, tag: stageTag ?? '', measure, parallel })))} />
          {rows.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-[var(--ct-line-2)] px-4 py-4 text-[13px] text-[var(--ct-text-3)]">Nenhuma etapa ainda. Adicione a primeira abaixo.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-center gap-2 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_6.5rem_12rem_auto]"
                >
                  <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: MEASURE_COLOR[row.measure] }} />
                  <input
                    value={row.name}
                    maxLength={60}
                    placeholder="Nome da etapa"
                    aria-label={`Nome da etapa ${index + 1}`}
                    onChange={(event) => patch(index, { name: event.target.value })}
                    className={smallField}
                  />
                  <input
                    value={row.tag ?? ''}
                    maxLength={24}
                    spellCheck={false}
                    placeholder="TAG"
                    aria-label={`Etiqueta da etapa ${row.name || index + 1}`}
                    onChange={(event) => patch(index, { tag: cleanTag(event.target.value) })}
                    className={`${smallField} ${mono}`}
                  />
                  <select
                    value={row.measure}
                    aria-label={`Jeito de medir da etapa ${row.name || index + 1}`}
                    onChange={(event) => patch(index, { measure: event.target.value as StageMeasure })}
                    className={`${smallField} col-span-3 sm:col-span-1`}
                  >
                    {STAGE_MEASURES.map((measure) => (
                      <option key={measure} value={measure}>
                        {MEASURES[measure].label} → {MEASURES[measure].cost}
                      </option>
                    ))}
                  </select>
                  <div className="col-span-3 flex items-center gap-1.5 sm:col-span-1">
                    <label className="mr-1 flex min-h-9 cursor-pointer items-center gap-1.5 text-[12.5px] text-[var(--ct-text-2)]">
                      <input type="checkbox" checked={row.parallel} onChange={(event) => patch(index, { parallel: event.target.checked })} className="h-4 w-4 accent-[var(--ct-accent)]" />
                      paralela
                    </label>
                    <span className="ml-auto flex gap-1.5">
                      <button type="button" disabled={index === 0} onClick={() => edit(moveItem(rows, index, -1))} aria-label={`Subir a etapa ${row.name || index + 1}`} className={iconButton}>
                        ↑
                      </button>
                      <button type="button" disabled={index === rows.length - 1} onClick={() => edit(moveItem(rows, index, 1))} aria-label={`Descer a etapa ${row.name || index + 1}`} className={iconButton}>
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => edit(rows.filter((_, i) => i !== index))}
                        aria-label={`Remover a etapa ${row.name || index + 1}`}
                        className={`${iconButton} hover:!border-[var(--ct-crit)] hover:!text-[var(--ct-crit)]`}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <select
            value=""
            disabled={rows.length >= MAX_PLANNED_STAGES}
            aria-label="Adicionar etapa"
            onChange={(event) => {
              const value = event.target.value
              if (!value) return
              const base: StageDraft = value === 'blank' ? { name: '', tag: null, measure: 'compra', parallel: false } : presets[Number(value)]
              edit([...rows, ...keyed([base])])
            }}
            className={`${smallField} self-start sm:w-auto`}
          >
            <option value="">+ Adicionar etapa</option>
            <optgroup label="Etapas prontas">
              {presets.map((preset, index) => (
                <option key={`${preset.name}-${index}`} value={index}>
                  {preset.name}
                  {preset.parallel ? ' (paralela)' : ''}
                </option>
              ))}
            </optgroup>
            <option value="blank">Etapa em branco</option>
          </select>
          {rows.length > 0 && <SequencePreview stages={orderPlanned(rows)} />}
          {issues.length > 0 && (
            <p role="status" className="text-[12.5px] text-[var(--ct-warn)]">
              Falta: {issues.join('; ')}.
            </p>
          )}
        </section>
      )}

      {state.error && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || issues.length > 0}
          className="rounded-full bg-[var(--ct-accent)] px-5 py-2.5 text-[13.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110 disabled:opacity-60"
        >
          {pending ? 'Criando…' : source ? 'Criar a partir do anterior' : 'Criar e montar etapas'}
        </button>
        <span className="text-[12.5px] text-[var(--ct-text-3)]">O funil nasce em rascunho e abre em Etapas e frentes. Produtos e metas vêm logo depois, no checklist.</span>
      </div>
    </form>
  )
}

function StageChips({ stages, resultIndex }: { stages: Pick<PlannedStage, 'name' | 'measure' | 'parallel'>[]; resultIndex?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {stages.map((stage, index) => (
        <span key={`${stage.name}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && !stage.parallel && (
            <span aria-hidden="true" className="text-[var(--ct-text-3)]">
              →
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
              index === resultIndex ? 'border-[var(--ct-ok)] bg-[var(--ct-ok-soft)]' : 'border-[var(--ct-line)] bg-[var(--ct-surface-2)]'
            } ${stage.parallel ? 'border-dashed' : ''}`}
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: MEASURE_COLOR[stage.measure] }} />
            {stage.name || 'sem nome'}
            {stage.parallel && <span className="text-[var(--ct-text-3)]">(paralela)</span>}
            {index === resultIndex && <span className="text-[var(--ct-ok)]">· resultado</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

/** The journey the canvas will open with, and which stage is the funnel's result (0107). */
function SequencePreview({ stages }: { stages: PlannedStage[] }) {
  const result = funnelResultStage(stages.map((stage) => ({ ...stage, archivedAt: null })))
  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-[var(--ct-surface-2)] px-3.5 py-3">
      <StageChips stages={stages} resultIndex={result?.position} />
      <p className="text-[12.5px] text-[var(--ct-text-2)]">
        {result ? (
          <>
            Resultado do funil: <b>{result.name || 'sem nome'}</b> ({MEASURES[result.measure].cost}), a última etapa da sequência fora a ascensão.
          </>
        ) : (
          <span className="text-[var(--ct-warn)]">Sem etapa de resultado: ponha na sequência uma etapa que não seja paralela nem ascensão.</span>
        )}
      </p>
    </div>
  )
}
