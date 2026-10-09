'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition, type DragEvent, type ReactNode } from 'react'
import { MEASURES, funnelResultStage, type CostCombo } from '@/lib/domain/funnel-stages'
import { clampZoom } from '@/lib/domain/canvas-zoom'
import {
  MEASURE_COLOR,
  NODE_WIDTH,
  PARALLEL_GAP,
  SEQUENCE_GAP,
  comboFormula,
  dropIndex,
  metaText,
  placeStage,
  sequenceEdges,
} from '@/lib/domain/stage-canvas'
import { addStage, applyNewTeto, archiveStage, moveFront, placeStageAction, removeCombo, removeFront, removePreset, removeStage, saveCombo, saveStage, savePreset, saveTestTeto, saveWatcherTargets, type StageActionResult } from './stage-actions'
import { ComboDrawer } from './combo-drawer'
import { StageDrawer, frontMetaText, mono } from './stage-drawer'
import type { CanvasContext, CanvasPreset, CanvasStage } from './canvas-types'

type Selection = { kind: 'stage'; id: string } | { kind: 'combo'; id: string | null } | null
type Lane = 'par' | 'seq'

const ZOOM_STEP = 0.1
// More fronts than this make the node taller than the canvas; the drawer lists them all.
const VISIBLE_FRONTS = 5
// The sequence track's top sits this far below the bottom of the parallel nodes: lane padding,
// the "Sequência" label and the parallel lane's bottom margin (see the classes below).
const RAIL_RISE = 80

const day = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

export function StagesCanvas({
  stages,
  archivedStages,
  combos,
  presets,
  ownPresets,
  canEdit,
  context,
  otherFunnels,
  metasHref,
  boardHref,
  initialStageId,
  naming,
}: {
  stages: CanvasStage[]
  archivedStages: { id: string; name: string }[]
  combos: CostCombo[]
  presets: CanvasPreset[]
  /** The palette is the client's own list (presets carry ids), not the built-in defaults. */
  ownPresets: boolean
  canEdit: boolean
  context: CanvasContext
  otherFunnels: { id: string; name: string }[]
  metasHref: string
  boardHref: string
  initialStageId: string | null
  /** The campaign naming card, rendered on the server, beside the combos. */
  naming: ReactNode
}) {
  const [shown, setShown] = useOptimistic(stages, (_current: CanvasStage[], next: CanvasStage[]) => next)
  const [pending, startTransition] = useTransition()
  const [selection, setSelection] = useState<Selection>(initialStageId && stages.some((stage) => stage.id === initialStageId) ? { kind: 'stage', id: initialStageId } : null)
  const [toast, setToast] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [drop, setDrop] = useState<{ lane: Lane; index: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [editingPresets, setEditingPresets] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const parTrackRef = useRef<HTMLDivElement>(null)
  const seqTrackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selection) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setSelection(null)
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [selection])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const parallel = shown.filter((stage) => stage.parallel)
  const sequence = shown.filter((stage) => !stage.parallel)
  const selectedStage = selection?.kind === 'stage' ? shown.find((stage) => stage.id === selection.id) : undefined
  const selectedCombo = selection?.kind === 'combo' ? (combos.find((combo) => combo.id === selection.id) ?? null) : undefined
  const resultId = funnelResultStage(shown)?.id

  /** Runs a write with the canvas already showing its result; a refusal reverts it and says why. */
  function run(optimistic: CanvasStage[] | null, write: () => Promise<StageActionResult & { id?: string }>, done?: (result: StageActionResult & { id?: string }) => void) {
    startTransition(async () => {
      if (optimistic) setShown(optimistic)
      const result = await write()
      if (result.error) setToast(result.error)
      else done?.(result)
    })
  }

  function place(stage: CanvasStage, toParallel: boolean, index: number | null) {
    const next = placeStage(shown, stage, toParallel, index)
    if (next.every((item, i) => item.id === shown[i]?.id && item.parallel === shown[i]?.parallel)) return
    run(next, () => placeStageAction(context, stage.id, toParallel, next.map((item) => item.id)))
  }

  function add(preset: CanvasPreset, toParallel: boolean, index: number | null) {
    const draft: CanvasStage = {
      id: 'new',
      salesFunnelId: context.sales_funnel_id,
      name: preset.name,
      tag: preset.tag,
      measure: preset.measure,
      position: 0,
      parallel: toParallel,
      janelaInicio: null,
      janelaFim: null,
      meta: null,
      metaRoas: null,
      archivedAt: null,
      fronts: [],
      watchers: [],
      tests: [],
      followers: { following: 0, specific: 0 },
      inUse: null,
      lastOpen: false,
    }
    const next = placeStage(shown, draft, toParallel, index)
    run(
      next,
      () => addStage(context, { name: preset.name, tag: preset.tag ?? '', measure: preset.measure, parallel: toParallel, order: next.map((item) => item.id) }),
      (result) => {
        setToast(`Etapa ${preset.name} criada.`)
        if (result.id) setSelection({ kind: 'stage', id: result.id })
      }
    )
  }

  function laneIndex(lane: Lane, clientX: number): number {
    const track = (lane === 'par' ? parTrackRef : seqTrackRef).current
    const count = (lane === 'par' ? parallel : sequence).length
    if (!track) return count
    return dropIndex((clientX - track.getBoundingClientRect().left) / zoom, count, lane === 'par' ? PARALLEL_GAP : SEQUENCE_GAP)
  }

  function onDragOver(lane: Lane, event: DragEvent) {
    if (!canEdit) return
    event.preventDefault()
    const index = laneIndex(lane, event.clientX)
    if (drop?.lane !== lane || drop.index !== index) setDrop({ lane, index })
  }

  function onDrop(lane: Lane, event: DragEvent) {
    if (!canEdit) return
    event.preventDefault()
    const index = laneIndex(lane, event.clientX)
    setDrop(null)
    setDragging(null)
    const data = event.dataTransfer.getData('text/plain')
    if (data.startsWith('preset:')) {
      const preset = presets[Number(data.slice(7))]
      if (preset) add(preset, lane === 'par', index)
    } else if (data.startsWith('stage:')) {
      const stage = shown.find((item) => item.id === data.slice(6))
      if (stage) place(stage, lane === 'par', index)
    }
  }

  function node(stage: CanvasStage, ordinal: string | null) {
    const info = MEASURES[stage.measure]
    const selected = selection?.kind === 'stage' && selection.id === stage.id
    const kv = [
      { label: info.cost, value: stage.meta === null ? 'sem meta' : `${info.direction === 'max' ? '≤' : '≥'} ${metaText(stage.measure, stage.meta)}`, missing: stage.meta === null },
      stage.measure === 'compra'
        ? { label: 'ROAS', value: stage.metaRoas ? `≥ ${stage.metaRoas.toLocaleString('pt-BR')}` : '—', missing: false }
        : { label: 'Mede', value: info.label.toLowerCase(), missing: false },
      { label: 'Etiqueta', value: stage.tag ?? 'falta', missing: !stage.tag },
      { label: 'Janela', value: stage.janelaInicio || stage.janelaFim ? `${stage.janelaInicio ? day(stage.janelaInicio) : '…'}–${stage.janelaFim ? day(stage.janelaFim) : '…'}` : 'contínua', missing: false },
    ]
    return (
      <div
        key={stage.id}
        role="button"
        tabIndex={0}
        draggable={canEdit && stage.id !== 'new'}
        aria-label={`Etapa ${stage.name}${ordinal ? `, ${ordinal} na sequência` : ', paralela'}${stage.id === resultId ? ', resultado do funil' : ''}. Abrir para editar`}
        aria-pressed={selected}
        onClick={() => stage.id !== 'new' && setSelection({ kind: 'stage', id: stage.id })}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && stage.id !== 'new') {
            event.preventDefault()
            setSelection({ kind: 'stage', id: stage.id })
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', `stage:${stage.id}`)
          event.dataTransfer.effectAllowed = 'move'
          setDragging(stage.id)
        }}
        onDragEnd={() => {
          setDragging(null)
          setDrop(null)
        }}
        style={{ width: NODE_WIDTH }}
        className={`card-shadow grid flex-none grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-[var(--ct-surface-3)] px-[18px] py-4 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 ${
          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${stage.parallel ? 'border-dashed border-[color-mix(in_srgb,var(--ct-ab)_50%,transparent)]' : 'border-[var(--ct-line)] hover:border-[var(--ct-line-2)]'} ${
          selected ? '!border-[var(--ct-accent)] shadow-[0_0_0_3px_var(--ct-accent-soft)]' : ''
        } ${dragging === stage.id || stage.id === 'new' ? 'opacity-40' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: MEASURE_COLOR[stage.measure] }} />
            <b className="truncate font-[family-name:var(--font-sora)] text-[15px] font-semibold tracking-[-0.02em]">{stage.name}</b>
          </span>
          {stage.id === resultId ? (
            <span title="A última etapa da sequência, fora a ascensão, é o resultado do funil." className="flex-none whitespace-nowrap rounded-full bg-[var(--ct-ok-soft)] px-2 py-0.5 text-[10.5px] text-[var(--ct-ok)]">
              {ordinal} · resultado
            </span>
          ) : ordinal ? (
            <span className={`${mono} flex-none rounded-full bg-[var(--ct-surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-2)]`}>{ordinal}</span>
          ) : (
            <span className="flex-none rounded-full bg-[color-mix(in_srgb,var(--ct-ab)_15%,transparent)] px-2 py-0.5 text-[10.5px] text-[var(--ct-ab)]">paralela</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
          {kv.map((item) => (
            <div key={item.label} className="grid min-w-0 gap-px">
              <span className={`${mono} text-[10px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>{item.label}</span>
              <b className={`${mono} truncate text-[14px] font-medium tabular-nums ${item.missing ? 'text-[var(--ct-warn)]' : ''}`}>{item.value}</b>
            </div>
          ))}
        </div>
        {stage.fronts.length > 0 && (
          <div className="grid min-w-0 gap-1 border-t border-[var(--ct-line)] pt-2.5">
            {stage.fronts.slice(0, VISIBLE_FRONTS).map((front) => {
              const meta = frontMetaText(front, stage)
              return (
                <div key={front.id} className="flex min-w-0 items-baseline gap-2 text-[12.5px] text-[var(--ct-text-2)]">
                  <span className="min-w-0 flex-1 truncate" title={front.name}>
                    {front.name} <em className={`${mono} not-italic text-[11.5px] text-[var(--ct-text-3)]`}>{front.rules.find((rule) => rule.kind === 'include')?.value ?? front.code}</em>
                  </span>
                  <em title={meta} className={`${mono} min-w-0 max-w-[55%] truncate not-italic text-[11.5px] text-[var(--ct-text-3)]`}>
                    {meta}
                  </em>
                </div>
              )
            })}
            {stage.fronts.length > VISIBLE_FRONTS && (
              <span className="text-[12px] text-[var(--ct-text-3)]">+{stage.fronts.length - VISIBLE_FRONTS} frentes</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <span className={`${mono} rounded-full bg-[var(--ct-surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-2)]`}>
            {stage.watchers.length} {stage.watchers.length === 1 ? 'vigia' : 'vigias'}
          </span>
          <span className={`${mono} rounded-full bg-[var(--ct-surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-2)]`}>
            {stage.tests.length} {stage.tests.length === 1 ? 'teste' : 'testes'}
          </span>
        </div>
      </div>
    )
  }

  function marker(lane: Lane) {
    if (drop?.lane !== lane) return null
    const gap = lane === 'par' ? PARALLEL_GAP : SEQUENCE_GAP
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 top-0 w-1 rounded bg-[var(--ct-accent)]"
        style={{ left: Math.max(0, drop.index * (NODE_WIDTH + gap) - gap / 2 - 2) }}
      />
    )
  }

  const edges = sequenceEdges(sequence.map((stage) => stage.measure))
  const lastCenter = (sequence.length - 1) * (NODE_WIDTH + SEQUENCE_GAP) + NODE_WIDTH / 2
  const laneClass = (lane: Lane) =>
    `rounded-[14px] border border-dashed p-1.5 -mx-1.5 transition-colors ${
      drop?.lane === lane
        ? lane === 'par'
          ? 'border-[var(--ct-ab)] bg-[color-mix(in_srgb,var(--ct-ab)_12%,transparent)]'
          : 'border-[var(--ct-accent)] bg-[var(--ct-accent-soft)]'
        : lane === 'par'
          ? 'border-[color-mix(in_srgb,var(--ct-ab)_35%,transparent)]'
          : 'border-transparent'
    }`
  const laneLabel = `${mono} mb-2.5 flex h-4 items-center gap-2.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--ct-text-3)]`

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-center gap-2" aria-label="Etapas prontas">
        <span className={`${mono} mr-1 text-[11px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>{canEdit ? 'Arraste para o canvas' : 'Etapas prontas'}</span>
        {presets.map((preset, index) => (
          <span
            key={`${preset.id ?? 'default'}-${preset.name}`}
            draggable={canEdit && !editingPresets}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', `preset:${index}`)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            className={`inline-flex select-none items-center gap-2 rounded-full border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] py-[5px] pl-3 pr-1.5 text-[13px] font-semibold ${
              canEdit && !editingPresets ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MEASURE_COLOR[preset.measure] }} />
            {preset.name}
            {canEdit &&
              (editingPresets ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Tirar ${preset.name} das etapas prontas`}
                  onClick={() => run(null, () => removePreset(context, preset.id, preset.name), () => setToast(`${preset.name} saiu das etapas prontas.`))}
                  className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--ct-surface-3)] font-bold text-[var(--ct-text-2)] hover:text-[var(--ct-crit)]"
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Adicionar ${preset.name} ${preset.parallel ? 'nas paralelas' : 'ao fim da sequência'}`}
                  onClick={() => add(preset, preset.parallel, null)}
                  className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--ct-surface-3)] font-bold text-[var(--ct-text-2)] hover:text-[var(--ct-accent)]"
                >
                  +
                </button>
              ))}
          </span>
        ))}
        {canEdit && (
          <button type="button" aria-pressed={editingPresets} onClick={() => setEditingPresets(!editingPresets)} className="text-[12px] font-medium text-[var(--ct-text-3)] hover:text-[var(--ct-text)] hover:underline">
            {editingPresets ? 'Pronto' : 'Editar lista'}
          </button>
        )}
        {editingPresets && !ownPresets && <span className="text-[12px] text-[var(--ct-text-3)]">A lista padrão vira a lista do cliente na primeira mudança.</span>}
      </div>

      <div
        ref={containerRef}
        className="relative h-[460px] overflow-auto rounded-2xl border border-[var(--ct-line)] sm:h-[560px]"
        style={{
          background:
            'radial-gradient(120% 90% at 8% 10%, rgba(124,111,240,0.08), transparent 55%), radial-gradient(90% 70% at 92% 85%, rgba(94,214,240,0.06), transparent 55%), var(--ct-bg)',
        }}
      >
        <div className="card-shadow sticky right-3 top-3 z-10 float-right -mb-12 mr-3 mt-3 flex items-center gap-1 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-3)] p-1.5">
          <button type="button" onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))} aria-label="Diminuir zoom" className="h-6 w-6 rounded-md text-sm font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            −
          </button>
          <span className={`${mono} w-10 text-center text-[11px] text-[var(--ct-text-2)]`}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))} aria-label="Aumentar zoom" className="h-6 w-6 rounded-md text-sm font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            +
          </button>
          <button
            type="button"
            onClick={() => {
              const container = containerRef.current
              const inner = innerRef.current
              if (container && inner) setZoom(clampZoom((container.clientWidth - 8) / inner.scrollWidth))
            }}
            className="ml-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          >
            Ajustar
          </button>
        </div>

        <div ref={innerRef} className="relative w-max min-w-full px-6 pb-7 pt-[22px]" style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <p className={laneLabel}>
            Paralelas <em className="font-[family-name:var(--font-body)] text-[12px] normal-case not-italic tracking-normal">rodam junto com a sequência · ex.: reconhecimento</em>
          </p>
          <div
            className={`${laneClass('par')} mb-10`}
            onDragOver={(event) => onDragOver('par', event)}
            onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setDrop(null)}
            onDrop={(event) => onDrop('par', event)}
          >
            <div ref={parTrackRef} className="relative flex min-h-24 items-start" style={{ gap: PARALLEL_GAP }}>
              {parallel.length ? parallel.map((stage) => node(stage, null)) : <span className="self-center px-2 py-[18px] text-[13px] text-[var(--ct-text-3)]">Solte aqui uma etapa que roda junto com a sequência.</span>}
              {marker('par')}
            </div>
          </div>
          <p className={laneLabel}>
            Sequência <em className="font-[family-name:var(--font-body)] text-[12px] normal-case not-italic tracking-normal">a ordem da jornada · a última etapa (fora ascensão) é o resultado do funil{canEdit ? ' · arraste para reordenar' : ''}</em>
          </p>
          <div
            className={laneClass('seq')}
            onDragOver={(event) => onDragOver('seq', event)}
            onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setDrop(null)}
            onDrop={(event) => onDrop('seq', event)}
          >
            <div ref={seqTrackRef} className="relative flex min-h-[120px] items-start" style={{ gap: SEQUENCE_GAP }}>
              <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
                {edges.map((edge) => (
                  <path key={edge.path} className="flow-edge" d={edge.path} stroke="var(--ct-accent)" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.75} />
                ))}
                {parallel.length > 0 && sequence.length > 0 && (
                  <path
                    d={`M${NODE_WIDTH / 2} ${-RAIL_RISE} L${NODE_WIDTH / 2} -18 L${lastCenter} -18`}
                    stroke="var(--ct-ab)"
                    strokeWidth={1.5}
                    strokeDasharray="4 5"
                    fill="none"
                    opacity={0.6}
                  />
                )}
              </svg>
              {edges.map((edge) => (
                <span
                  key={edge.label + edge.labelX}
                  aria-hidden="true"
                  className={`${mono} pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--ct-line)] bg-[var(--ct-bg)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-3)]`}
                  style={{ left: edge.labelX, top: edge.labelY }}
                >
                  {edge.label}
                </span>
              ))}
              {sequence.length ? (
                sequence.map((stage, index) => node(stage, `${index + 1}º`))
              ) : (
                <span className="self-center px-2 py-[18px] text-[13px] text-[var(--ct-text-3)]">Arraste uma etapa para começar a jornada.</span>
              )}
              {marker('seq')}
            </div>
          </div>
        </div>
      </div>

      {archivedStages.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">Etapas arquivadas ({archivedStages.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {archivedStages.map((stage) => (
              <li key={stage.id} className="flex items-center gap-3 text-[12.5px] text-[var(--ct-text-2)]">
                {stage.name}
                {canEdit && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(null, () => archiveStage(context, stage.id, false), () => setToast(`Etapa ${stage.name} restaurada.`))}
                    className="text-xs font-semibold text-[var(--ct-accent)] hover:underline"
                  >
                    Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="card-shadow grid min-w-0 gap-3.5 rounded-[22px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-[22px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 className="text-[17px] font-semibold">Custos combinados</h2>
            <p className="text-[12.5px] text-[var(--ct-text-3)]">Cada etapa usa só o próprio gasto. Some etapas aqui quando quiser.</p>
          </div>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {combos.map((combo) => (
              <button
                key={combo.id}
                type="button"
                aria-pressed={selection?.kind === 'combo' && selection.id === combo.id}
                onClick={() => setSelection({ kind: 'combo', id: combo.id })}
                className={`grid gap-1.5 rounded-[14px] border bg-[var(--ct-surface-2)] px-3.5 py-3 text-left transition-colors hover:border-[var(--ct-text-3)] ${
                  selection?.kind === 'combo' && selection.id === combo.id ? 'border-[var(--ct-accent)] shadow-[0_0_0_3px_var(--ct-accent-soft)]' : 'border-[var(--ct-line-2)]'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="text-[13.5px]">{combo.name}</b>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] ${combo.enabled ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]'}`}
                  >
                    {combo.enabled ? 'ligado' : 'desligado'}
                  </span>
                </span>
                <span className={`${mono} text-[11.5px] text-[var(--ct-text-2)]`}>{comboFormula(combo, shown)}</span>
              </button>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={() => setSelection({ kind: 'combo', id: null })}
                className="grid min-h-[72px] place-content-center rounded-[14px] border border-dashed border-[var(--ct-line-2)] text-center text-[13px] font-semibold text-[var(--ct-text-3)] hover:border-[var(--ct-text-3)]"
              >
                + Custo combinado
              </button>
            )}
            {!canEdit && combos.length === 0 && <p className="text-[12.5px] text-[var(--ct-text-3)]">Nenhum custo combinado.</p>}
          </div>
        </section>
        {naming}
      </div>

      {selectedStage && (
        <StageDrawer
          key={selectedStage.id}
          stage={selectedStage}
          stages={shown}
          ordinal={selectedStage.parallel ? null : `${sequence.indexOf(selectedStage) + 1}º`}
          peers={{ index: (selectedStage.parallel ? parallel : sequence).indexOf(selectedStage), count: (selectedStage.parallel ? parallel : sequence).length }}
          canEdit={canEdit}
          context={context}
          otherFunnels={otherFunnels}
          metasHref={metasHref}
          boardHref={boardHref}
          pending={pending}
          onClose={() => setSelection(null)}
          onSave={(fields) => run(null, () => saveStage(context, selectedStage.id, fields), () => setToast('Etapa salva.'))}
          onSaveWatcher={(watcherId, input) => run(null, () => saveWatcherTargets(context, watcherId, input), () => setToast('Vigia salvo e reavaliado.'))}
          onSaveTestTeto={(itemId, teto) => run(null, () => saveTestTeto(context, itemId, teto), () => setToast(teto === null ? 'O teste segue o teto do funil.' : 'O teste tem teto próprio.'))}
          onApplyNewTeto={(itemId) => run(null, () => applyNewTeto(context, itemId), () => setToast('O teste agora é julgado com a meta nova.'))}
          onPlace={(toParallel, index) => place(selectedStage, toParallel, index)}
          onArchive={() =>
            run(null, () => archiveStage(context, selectedStage.id, true), () => {
              setSelection(null)
              setToast(`Etapa ${selectedStage.name} arquivada.`)
            })
          }
          onRemove={() =>
            run(
              shown.filter((stage) => stage.id !== selectedStage.id),
              () => removeStage(context, selectedStage.id),
              () => {
                setSelection(null)
                setToast(`Etapa ${selectedStage.name} removida.`)
              }
            )
          }
          onRemoveFront={(frontId) => {
            const front = selectedStage.fronts.find((item) => item.id === frontId)
            const next = shown.map((stage) => ({ ...stage, fronts: stage.fronts.filter((item) => item.id !== frontId) }))
            run(next, () => removeFront(context, frontId), () => setToast(`Frente ${front?.name ?? ''} removida.`))
          }}
          onSavePreset={() =>
            run(
              null,
              () => savePreset(context, { name: selectedStage.name, tag: selectedStage.tag, measure: selectedStage.measure, parallel: selectedStage.parallel }),
              () => setToast(`${selectedStage.name} entrou nas etapas prontas.`)
            )
          }
          onMoveFront={(frontId, stageId) => {
            const front = selectedStage.fronts.find((item) => item.id === frontId)
            const next = shown.map((stage) => ({
              ...stage,
              fronts: stage.id === stageId && front ? [...stage.fronts, front] : stage.fronts.filter((item) => item.id !== frontId),
            }))
            run(next, () => moveFront(context, frontId, stageId), () => setToast(`Frente ${front?.name ?? ''} movida.`))
          }}
        />
      )}
      {selectedCombo !== undefined && (
        <ComboDrawer
          key={selectedCombo?.id ?? 'new'}
          combo={selectedCombo}
          stages={shown}
          canEdit={canEdit}
          pending={pending}
          onClose={() => setSelection(null)}
          onSave={(fields) =>
            run(null, () => saveCombo(context, selectedCombo?.id ?? null, fields, combos.length), () => {
              setToast('Custo combinado salvo.')
              if (!selectedCombo) setSelection(null)
            })
          }
          onRemove={() =>
            selectedCombo &&
            run(null, () => removeCombo(context, selectedCombo.id), () => {
              setSelection(null)
              setToast('Custo combinado apagado.')
            })
          }
        />
      )}

      {toast && (
        <div role="status" className="card-shadow fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[var(--ct-line-2)] bg-[var(--ct-surface-3)] px-4 py-2 text-[13px]">
          {toast}
        </div>
      )}
    </div>
  )
}
