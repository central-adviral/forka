'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MEASURES, STAGE_MEASURES, type StageMeasure } from '@/lib/domain/funnel-stages'
import { PROJECT_RESULTS, type ProjectResult } from '@/lib/domain/project-plan'
import { cleanTag, metaFromInput, metaToInput } from '@/lib/domain/stage-canvas'
import { TETO_MEDIDA, decidesCreatives, followersLine, frontPrincipalMeta, sourceLabel, tetoChanged, type TestTeto, type TetoMedida } from '@/lib/domain/targets'
import { decimalInput, formatMetric } from '@/lib/domain/watchers'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { PAGE_KINDS, PAGE_KIND_LABEL } from '@/lib/domain/new-funnel'
import { addFrontPage, addRule, createFront, previewRule, removeRule, setFrontArchived, unlinkFrontPage, updateFront, updateRule } from './actions'
import { RuleForm } from './rule-form'
import type { StageFields, WatcherTargetsInput } from './stage-actions'
import type { CanvasContext, CanvasFront, CanvasStage, CanvasTest, CanvasWatcher } from './canvas-types'

export const mono = 'font-[family-name:var(--font-geist-mono)]'
export const field =
  'w-full min-w-0 rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)] disabled:opacity-60'
export const label = 'flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--ct-text-2)]'
export const smallButton =
  'rounded-full border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-1 text-[12px] font-semibold text-[var(--ct-text-2)] hover:border-[var(--ct-text-3)] hover:text-[var(--ct-text)] disabled:cursor-default disabled:opacity-45'
export const primaryButton = 'rounded-full bg-[var(--ct-accent)] px-4 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110 disabled:opacity-50'
const sectionTitle = `${mono} text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ct-text-3)]`

const MEASURE_HINT: Record<StageMeasure, string> = {
  alcance: 'gasto da etapa ÷ mil impressões',
  lead: 'gasto da etapa ÷ leads do Meta Ads',
  visita: 'gasto da etapa ÷ visitas na página',
  compra: 'gasto da etapa ÷ vendas de entrada',
  ascensao: 'compradores de ascensão ÷ compradores de entrada',
}

const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** A stage meta in its measure's format: R$ 6,00, or 12% for the ascension rate. */
function stageMetaValue(measure: StageMeasure, value: number | null): string {
  if (value === null) return 'sem meta'
  return MEASURES[measure].format === 'pct' ? `${metaToInput(measure, value)}%` : brl(value)
}

/** "segue a etapa · R$ 6,00" or "específica · CPL R$ 4,50": the front's principal meta and where it comes from (0106). */
export function frontMetaText(front: Pick<CanvasFront, 'metricaPrincipal' | 'alvoPrincipal'> & { metricaSecundaria?: ProjectResult | null; alvoSecundaria?: number | null }, stage: Pick<CanvasStage, 'measure' | 'meta' | 'metaRoas'>): string {
  const meta = frontPrincipalMeta({ stageId: '', metricaPrincipal: front.metricaPrincipal, alvoPrincipal: front.alvoPrincipal, metricaSecundaria: front.metricaSecundaria ?? null, alvoSecundaria: front.alvoSecundaria ?? null }, { id: '', position: 0, archivedAt: null, ...stage })
  if (meta.source === 'etapa') return `segue a etapa · ${stageMetaValue(stage.measure, meta.value)}`
  const metric = front.metricaPrincipal!
  const value = PROJECT_RESULTS[metric].higherIsBetter ? `${decimalInput(meta.value!)}x` : brl(meta.value!)
  return `específica · ${PROJECT_RESULTS[metric].cost} ${value}`
}

function tetoText(value: number | null, medida: TetoMedida | null): string {
  if (value === null || !medida) return 'sem teto'
  return `${TETO_MEDIDA[medida].cost} ${medida === 'roas' ? `${decimalInput(value)}x` : brl(value)}`
}

/** The right-hand panel shared by the stage and the combo editors (the Quadro's drawer look). */
export function Drawer({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])
  return (
    <aside
      role="dialog"
      aria-label={`${eyebrow}: ${title}`}
      className="fixed bottom-3.5 right-3.5 top-3.5 z-50 flex w-[min(460px,calc(100vw-28px))] flex-col overflow-hidden rounded-[22px] border border-[var(--ct-line-2)] bg-[var(--ct-surface)] shadow-[var(--ct-shadow)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--ct-line)] px-[22px] pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <span className={`${mono} text-[11px] uppercase tracking-[0.08em] text-[var(--ct-accent)]`}>{eyebrow}</span>
          <h2 ref={titleRef} tabIndex={-1} className="mt-1 truncate text-[20px] font-semibold outline-none">
            {title}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-9 w-9 flex-none place-items-center rounded-[9px] text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]">
          ✕
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-7 pt-[18px]">{children}</div>
    </aside>
  )
}

export function DrawerSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-[var(--ct-line)] pt-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className={sectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StageDrawer({
  stage,
  stages,
  ordinal,
  peers,
  canEdit,
  context,
  otherFunnels,
  metasHref,
  boardHref,
  pending,
  onClose,
  onSave,
  onPlace,
  onArchive,
  onSavePreset,
  onMoveFront,
  onSaveWatcher,
  onSaveTestTeto,
  onApplyNewTeto,
}: {
  stage: CanvasStage
  stages: CanvasStage[]
  /** "2º" in the sequence; null for a parallel stage. */
  ordinal: string | null
  /** The stage's index in its lane and the lane's size, for "Antes" and "Depois". */
  peers: { index: number; count: number }
  canEdit: boolean
  context: CanvasContext
  otherFunnels: { id: string; name: string }[]
  metasHref: string
  boardHref: string
  pending: boolean
  onClose: () => void
  onSave: (fields: StageFields) => void
  onPlace: (parallel: boolean, index: number | null) => void
  onArchive: () => void
  onSavePreset: () => void
  onMoveFront: (frontId: string, stageId: string) => void
  onSaveWatcher: (watcherId: string, input: WatcherTargetsInput) => void
  onSaveTestTeto: (itemId: string, teto: number | null) => void
  onApplyNewTeto: (itemId: string) => void
}) {
  const [draft, setDraft] = useState(() => draftOf(stage))
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const info = MEASURES[draft.measure]
  const frontContext = { ...context, stage_id: stage.id }
  const set = (patch: Partial<StageFields>) => setDraft((current) => ({ ...current, ...patch }))
  const metaChanged = draft.meta !== metaToInput(stage.measure, stage.meta) || (stage.measure === 'compra' && draft.metaRoas !== metaToInput('compra', stage.metaRoas))

  return (
    <Drawer eyebrow={stage.parallel ? 'Etapa paralela' : `Etapa · ${ordinal} na sequência`} title={stage.name} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className={label}>
              Nome
              <input required maxLength={60} value={draft.name} onChange={(event) => set({ name: event.target.value })} className={field} />
            </label>
            <label className={label}>
              Etiqueta
              <input
                maxLength={24}
                value={draft.tag}
                placeholder="ex.: CAP"
                onChange={(event) => set({ tag: cleanTag(event.target.value) ?? '' })}
                className={`${field} ${mono}`}
                spellCheck={false}
              />
            </label>
          </div>
          <label className={label}>
            Jeito de medir
            <select value={draft.measure} onChange={(event) => set({ measure: event.target.value as StageMeasure })} className={field}>
              {STAGE_MEASURES.map((measure) => (
                <option key={measure} value={measure}>
                  {MEASURES[measure].label} → {MEASURES[measure].cost}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12.5px] text-[var(--ct-text-3)]">
            {info.cost} = {MEASURE_HINT[draft.measure]}. Só o gasto das campanhas desta etapa entra; a etiqueta, quando tem, precisa estar no nome de cada
            campanha das frentes dela.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <label className={label}>
              Meta · {info.cost} {info.direction === 'max' ? '≤' : '≥'}
              <input
                inputMode="decimal"
                value={draft.meta}
                placeholder={info.format === 'pct' ? 'em %' : 'você define'}
                onChange={(event) => set({ meta: event.target.value })}
                className={`${field} ${mono}`}
              />
            </label>
            {draft.measure === 'compra' ? (
              <label className={label}>
                Secundária · ROAS ≥
                <input inputMode="decimal" value={draft.metaRoas} onChange={(event) => set({ metaRoas: event.target.value })} className={`${field} ${mono}`} />
              </label>
            ) : (
              <span />
            )}
            <label className={label}>
              Início
              <input type="date" value={draft.janelaInicio} onChange={(event) => set({ janelaInicio: event.target.value })} className={field} />
            </label>
            <label className={label}>
              Fim
              <input type="date" value={draft.janelaFim} onChange={(event) => set({ janelaFim: event.target.value })} className={field} />
            </label>
          </div>
          <p className={`text-[12px] ${metaChanged ? 'font-medium text-[var(--ct-warn)]' : 'text-[var(--ct-text-3)]'}`} role={metaChanged ? 'status' : undefined}>
            {metaChanged ? 'Ao salvar a meta nova: ' : ''}
            {followersLine(stage.followers)} Testes que já rodam seguem com o teto com que começaram.
          </p>
          <p className="text-[12px] text-[var(--ct-text-3)]">Sem datas, a etapa é contínua: conta todos os dias do funil.</p>
          {canEdit && (
            <div>
              <button type="submit" className={primaryButton}>
                {pending ? 'Salvando…' : 'Salvar etapa'}
              </button>
            </div>
          )}
        </fieldset>
      </form>

      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {!stage.parallel && (
            <>
              <button type="button" className={smallButton} disabled={pending || peers.index <= 0} onClick={() => onPlace(false, peers.index - 1)}>
                ← Antes
              </button>
              <button type="button" className={smallButton} disabled={pending || peers.index >= peers.count - 1} onClick={() => onPlace(false, peers.index + 2)}>
                Depois →
              </button>
            </>
          )}
          <button type="button" className={smallButton} disabled={pending} onClick={() => onPlace(!stage.parallel, null)}>
            {stage.parallel ? 'Pôr na sequência' : 'Tornar paralela'}
          </button>
          <button type="button" className={smallButton} disabled={pending} onClick={onSavePreset}>
            Salvar como etapa pronta
          </button>
          <ConfirmButton label="Arquivar etapa" warning="Arquivar a etapa? Frentes ativas precisam sair antes." onConfirm={onArchive} disabled={pending} />
        </div>
      )}

      <DrawerSection title={`Frentes (${stage.fronts.length})`}>
        {stage.fronts.length === 0 && <p className="text-[12.5px] text-[var(--ct-text-3)]">Nenhuma frente: a etapa ainda não pega campanha nenhuma.</p>}
        {stage.fronts.map((front) => (
          <FrontItem
            key={front.id}
            front={front}
            stage={stage}
            stages={stages}
            canEdit={canEdit}
            context={frontContext}
            editingRule={editingRule}
            onEditRule={setEditingRule}
            onMove={(stageId) => onMoveFront(front.id, stageId)}
          />
        ))}
        {canEdit && (
          <form action={createFront.bind(null, frontContext)} className="flex flex-col gap-2 rounded-[14px] border border-dashed border-[var(--ct-line-2)] px-3 py-3">
            <input type="hidden" name="stage_id" value={stage.id} />
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
              <label className={label}>
                Código
                <input name="code" required maxLength={24} placeholder="FRIO" className={`${field} ${mono}`} />
              </label>
              <label className={label}>
                Nome
                <input name="name" required maxLength={60} placeholder="Público frio" className={field} />
              </label>
            </div>
            <label className={label}>
              Campanhas
              <select name="source_sales_funnel_id" defaultValue="" className={field}>
                <option value="">próprias, pelas etiquetas</option>
                {otherFunnels.map((other) => (
                  <option key={other.id} value={other.id}>
                    lê o funil {other.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Janela do espelho: início
                <input type="date" name="janela_inicio" className={field} />
              </label>
              <label className={label}>
                Janela do espelho: fim
                <input type="date" name="janela_fim" className={field} />
              </label>
            </div>
            <div>
              <button type="submit" className={smallButton}>
                + Frente
              </button>
            </div>
          </form>
        )}
      </DrawerSection>

      <DrawerSection
        title={`Vigias (${stage.watchers.length})`}
        action={
          <a href={metasHref} className="text-[12.5px] font-medium text-[var(--ct-accent)] hover:underline">
            Editar em Metas e vigias
          </a>
        }
      >
        {stage.watchers.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ct-text-3)]">Nenhum vigia olha esta etapa ainda.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stage.watchers.map((watcher) => (
              <WatcherItem key={watcher.id} watcher={watcher} canEdit={canEdit} pending={pending} onSave={(input) => onSaveWatcher(watcher.id, input)} />
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection
        title={`Testes (${stage.tests.length})`}
        action={
          <a href={boardHref} className="text-[12.5px] font-medium text-[var(--ct-accent)] hover:underline">
            Ver no Quadro de testes
          </a>
        }
      >
        {stage.tests.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ct-text-3)]">Nenhum teste do Quadro está nesta etapa.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stage.tests.map((test) => (
              <TestItem key={test.id} test={test} canEdit={canEdit} pending={pending} onSaveTeto={(teto) => onSaveTestTeto(test.id, teto)} onApplyNew={() => onApplyNewTeto(test.id)} />
            ))}
          </ul>
        )}
      </DrawerSection>
    </Drawer>
  )
}

const item = 'flex flex-col gap-1.5 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-2 text-[12.5px]'
const pill = (own: boolean) => `rounded-full px-2 py-0.5 text-[11px] ${own ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-accent)]' : 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]'}`

/** A watcher of the stage: its meta and band, each "segue" or its own, editable in place. */
function WatcherItem({ watcher, canEdit, pending, onSave }: { watcher: CanvasWatcher; canEdit: boolean; pending: boolean; onSave: (input: WatcherTargetsInput) => void }) {
  const [editing, setEditing] = useState(false)
  const [ownTarget, setOwnTarget] = useState(watcher.ownTarget !== null)
  const [target, setTarget] = useState(watcher.ownTarget !== null ? decimalInput(watcher.ownTarget) : '')
  const [ownBand, setOwnBand] = useState(watcher.ownBand)
  const [warn, setWarn] = useState(decimalInput(watcher.warnPct))
  const [crit, setCrit] = useState(decimalInput(watcher.critPct))
  const followed = watcher.targetSource === 'especifica' ? 'específica' : sourceLabel(watcher.targetSource, watcher.targetStageName ?? undefined)
  return (
    <li className={item}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-semibold">{watcher.label}</b>
        <span className="text-[var(--ct-text-3)]">{watcher.scope}</span>
        <span className={`ml-auto ${pill(watcher.targetSource === 'especifica')}`}>{followed}</span>
        <span className={mono}>{formatMetric(watcher.metric, watcher.target)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ct-text-3)]">
        faixa {decimalInput(watcher.warnPct)}% / {decimalInput(watcher.critPct)}% · {watcher.ownBand ? 'própria' : 'segue a faixa padrão do funil'}
        {canEdit && (
          <button type="button" onClick={() => setEditing(!editing)} className="ml-auto font-medium text-[var(--ct-accent)] hover:underline">
            {editing ? 'fechar' : 'editar'}
          </button>
        )}
      </div>
      {editing && (
        <form
          className="flex flex-col gap-2 border-t border-[var(--ct-line)] pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              target: ownTarget ? metaFromInput('lead', target) : null,
              band: ownBand ? { warnPct: metaFromInput('lead', warn) ?? NaN, critPct: metaFromInput('lead', crit) ?? NaN } : null,
            })
          }}
        >
          {watcher.source === 'livre' ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Meta do vigia</legend>
              <label className="flex items-center gap-1">
                <input type="radio" checked={!ownTarget} onChange={() => setOwnTarget(false)} /> segue
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={ownTarget} onChange={() => setOwnTarget(true)} /> específica
              </label>
              <input inputMode="decimal" value={target} disabled={!ownTarget} onChange={(event) => setTarget(event.target.value)} aria-label="Meta específica do vigia" className={`${field} ${mono} w-24 py-1`} />
            </fieldset>
          ) : (
            <p className="text-[11.5px] text-[var(--ct-text-3)]">{watcher.source === 'plano' ? 'A meta é a do resultado do funil: segue a etapa.' : 'A meta é a da frente, no editar da frente.'}</p>
          )}
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Faixa do vigia</legend>
            <label className="flex items-center gap-1">
              <input type="radio" checked={!ownBand} onChange={() => setOwnBand(false)} /> faixa do funil
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={ownBand} onChange={() => setOwnBand(true)} /> própria
            </label>
            <input inputMode="decimal" value={warn} disabled={!ownBand} onChange={(event) => setWarn(event.target.value)} aria-label="Atenção a partir de, em %" className={`${field} ${mono} w-14 py-1`} />
            <input inputMode="decimal" value={crit} disabled={!ownBand} onChange={(event) => setCrit(event.target.value)} aria-label="Crítico a partir de, em %" className={`${field} ${mono} w-14 py-1`} />
          </fieldset>
          <div>
            <button type="submit" disabled={pending} className={smallButton}>
              Salvar vigia
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

/** A test of the stage: the teto it judges with, where it comes from, and the "a meta mudou" banner. */
function TestItem({ test, canEdit, pending, onSaveTeto, onApplyNew }: { test: CanvasTest; canEdit: boolean; pending: boolean; onSaveTeto: (teto: number | null) => void; onApplyNew: () => void }) {
  const [editing, setEditing] = useState(false)
  const [own, setOwn] = useState(test.teto !== null)
  const [value, setValue] = useState(test.teto !== null ? decimalInput(test.teto) : '')
  const started = { value: test.tetoInicial, medida: test.tetoMedida }
  const judged: TestTeto | typeof started = test.running ? started : test.tetoNow
  const changed = test.running && tetoChanged(started, test.tetoNow)
  return (
    <li className={item}>
      <div className="flex justify-between gap-3">
        <span className="min-w-0 truncate">
          <b className={mono}>{test.code}</b> · {test.title}
        </span>
        <span className="flex-none text-[var(--ct-text-3)]">{test.status}</span>
      </div>
      {test.meta && test.status !== 'Decidido' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ct-text-2)]">
            teto <span className={mono}>{tetoText(judged.value, judged.medida)}</span>
            <span className={pill(test.running || test.tetoNow.source === 'especifica')}>{test.running ? 'o teto com que começou' : sourceLabel(test.tetoNow.source)}</span>
            {!decidesCreatives(judged.medida) && <span className="text-[var(--ct-warn)]">esta etapa ainda não decide testes de criativo</span>}
            {canEdit && (
              <button type="button" onClick={() => setEditing(!editing)} className="ml-auto font-medium text-[var(--ct-accent)] hover:underline">
                {editing ? 'fechar' : 'teto próprio'}
              </button>
            )}
          </div>
          {changed && (
            <div role="status" className="flex flex-col gap-1.5 rounded-[10px] bg-[var(--ct-warn-soft)] px-2.5 py-2 text-[12px]">
              <span>
                A meta da etapa mudou para {tetoText(test.tetoNow.value, test.tetoNow.medida)}. Este teste segue com {tetoText(test.tetoInicial, test.tetoMedida)}, o teto com que começou.
              </span>
              {canEdit && (
                <button type="button" disabled={pending} onClick={onApplyNew} className={`${primaryButton} self-start`}>
                  Usar a meta nova
                </button>
              )}
            </div>
          )}
          {editing && (
            <form
              className="flex flex-wrap items-center gap-2 border-t border-[var(--ct-line)] pt-2"
              onSubmit={(event) => {
                event.preventDefault()
                onSaveTeto(own ? metaFromInput('lead', value) : null)
              }}
            >
              <label className="flex items-center gap-1">
                <input type="radio" checked={!own} onChange={() => setOwn(false)} /> segue
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={own} onChange={() => setOwn(true)} /> específico
              </label>
              <input inputMode="decimal" value={value} disabled={!own} onChange={(event) => setValue(event.target.value)} aria-label={`Teto próprio de ${test.code}`} className={`${field} ${mono} w-24 py-1`} />
              <button type="submit" disabled={pending} className={smallButton}>
                Salvar teto
              </button>
            </form>
          )}
        </>
      )}
    </li>
  )
}

function draftOf(stage: CanvasStage): StageFields {
  return {
    name: stage.name,
    tag: stage.tag ?? '',
    measure: stage.measure,
    meta: metaToInput(stage.measure, stage.meta),
    metaRoas: metaToInput('compra', stage.metaRoas),
    janelaInicio: stage.janelaInicio ?? '',
    janelaFim: stage.janelaFim ?? '',
  }
}

/** A two-step button for a client-side action, the same look as ConfirmDeleteButton. */
export function ConfirmButton({ label: text, warning, onConfirm, disabled }: { label: string; warning: string; onConfirm: () => void; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button type="button" disabled={disabled} onClick={() => setConfirming(true)} className={`${smallButton} hover:!border-[var(--ct-crit)] hover:!text-[var(--ct-crit)]`}>
        {text}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[var(--ct-crit)]">{warning}</span>
      <button
        type="button"
        onClick={() => {
          setConfirming(false)
          onConfirm()
        }}
        className="text-xs font-semibold text-[var(--ct-crit)] underline"
      >
        Sim
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[var(--ct-text-2)]">
        Não
      </button>
    </span>
  )
}

function FrontItem({
  front,
  stage,
  stages,
  canEdit,
  context,
  editingRule,
  onEditRule,
  onMove,
}: {
  front: CanvasFront
  stage: CanvasStage
  stages: CanvasStage[]
  canEdit: boolean
  context: CanvasContext & { stage_id: string }
  editingRule: string | null
  onEditRule: (ruleId: string | null) => void
  onMove: (stageId: string) => void
}) {
  const frontContext = { ...context, front_id: front.id }
  const includes = front.rules.filter((rule) => rule.kind === 'include')
  const smallField = `${field} py-1 text-[12px]`
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[13.5px] font-semibold">{front.name}</b>
        <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]`}>{front.code}</span>
        <span className={`${mono} ml-auto text-[11.5px] text-[var(--ct-text-3)]`}>
          {front.campaigns} campanhas · {front.spend.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
        </span>
      </div>
      <p className="text-[12px] text-[var(--ct-text-2)]">
        {(() => {
          const text = frontMetaText(front, stage)
          const own = text.startsWith('específica')
          return (
            <>
              <span className={`mr-1.5 ${pill(own)}`}>{own ? 'específica' : 'segue a etapa'}</span>
              {text.split(' · ').slice(1).join(' · ')}
            </>
          )
        })()}
      </p>
      {front.sourceName ? (
        <p className="text-[12px] text-[var(--ct-text-2)]">
          Lê as campanhas do funil <b>{front.sourceName}</b>, só nos dias da janela. Não tem etiquetas próprias.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {front.rules.map((rule) =>
            canEdit && editingRule === rule.id ? (
              <form key={rule.id} action={updateRule.bind(null, { ...frontContext, rule_id: rule.id })} className="flex flex-wrap items-center gap-1.5">
                <select name="kind" defaultValue={rule.kind} className={`${smallField} w-auto`} aria-label="Tipo da etiqueta">
                  <option value="include">contém</option>
                  <option value="exclude">não contém</option>
                </select>
                <input name="value" required defaultValue={rule.value} autoFocus className={`${smallField} ${mono} w-44`} aria-label="Texto da etiqueta" />
                <button type="submit" className="text-[12px] font-medium text-[var(--ct-accent)] hover:underline">
                  salvar
                </button>
                <button type="button" onClick={() => onEditRule(null)} className="text-[12px] text-[var(--ct-text-2)] hover:underline">
                  cancelar
                </button>
              </form>
            ) : (
              <span
                key={rule.id}
                className={`${mono} flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ${
                  rule.kind === 'include' ? 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'
                }`}
              >
                {rule.kind === 'include' ? 'contém' : 'não contém'} {rule.value}
                {canEdit && (
                  <button type="button" onClick={() => onEditRule(rule.id)} aria-label={`Editar etiqueta ${rule.value}`} className="opacity-60 hover:underline hover:opacity-100">
                    editar
                  </button>
                )}
                {canEdit && (
                  <form action={removeRule.bind(null, { ...context, rule_id: rule.id })}>
                    <button type="submit" aria-label={`Remover etiqueta ${rule.value}`} className="opacity-60 hover:opacity-100">
                      ×
                    </button>
                  </form>
                )}
              </span>
            )
          )}
          {includes.length === 0 && <span className="text-[12px] text-[var(--ct-warn)]">sem etiqueta “contém”, esta frente não pega nenhuma campanha</span>}
        </div>
      )}
      {canEdit && !front.sourceName && (
        <RuleForm addAction={addRule.bind(null, frontContext)} previewAction={previewRule.bind(null, frontContext)} fieldClass={smallField} mono={mono} />
      )}
      {!front.sourceName && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--ct-line)] pt-2">
          <span className="text-[12px] font-medium text-[var(--ct-text-2)]">Páginas desta frente</span>
          {front.pages.length === 0 && <span className="text-[12px] text-[var(--ct-text-3)]">Nenhuma (opcional): com uma página, a sonda avisa se ela cair.</span>}
          {front.pages.length > 0 && (
            <ul className="flex flex-col gap-1">
              {front.pages.map((page) => (
                <li key={page.id} className="flex min-w-0 items-center gap-2 text-[12px]">
                  <span className="flex-none rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]">{page.tipo ? PAGE_KIND_LABEL[page.tipo] : 'página'}</span>
                  <a href={page.url} target="_blank" rel="noreferrer" className={`${mono} min-w-0 flex-1 truncate text-[var(--ct-text)] hover:text-[var(--ct-accent)] hover:underline`}>
                    {page.url.replace('https://', '')}
                  </a>
                  {!page.isActive && <span className="flex-none text-[11px] text-[var(--ct-text-3)]">pausada</span>}
                  {canEdit && (
                    <form action={unlinkFrontPage.bind(null, { ...context, page_id: page.id })}>
                      <button type="submit" aria-label={`Desligar ${page.url} da frente ${front.name}`} className="flex-none text-[11.5px] text-[var(--ct-text-3)] hover:text-[var(--ct-crit)] hover:underline">
                        desligar
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form action={addFrontPage.bind(null, { ...frontContext, front_name: front.name })} className="grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-1.5">
              <select name="tipo" defaultValue={stage.measure === 'lead' ? 'captura' : 'vendas'} aria-label={`Tipo da página da frente ${front.name}`} className={smallField}>
                {PAGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {PAGE_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <input name="url" required inputMode="url" placeholder="exemplo.com/aula" aria-label={`Endereço da página da frente ${front.name}`} className={`${smallField} ${mono}`} />
              <button type="submit" className={smallButton}>
                + Página
              </button>
            </form>
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--ct-text-3)]">
            Mover para
            <select
              value={stage.id}
              onChange={(event) => onMove(event.target.value)}
              aria-label={`Mover a frente ${front.name} para outra etapa`}
              className={`${smallField} w-auto`}
            >
              {stages.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <details className="group">
            <summary className="cursor-pointer list-none text-[12px] font-medium text-[var(--ct-accent)] hover:underline">Editar frente</summary>
            <form action={updateFront.bind(null, frontContext)} className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                <label className={label}>
                  Código
                  <input name="code" required defaultValue={front.code} className={`${smallField} ${mono}`} />
                </label>
                <label className={label}>
                  Nome
                  <input name="name" required defaultValue={front.name} className={smallField} />
                </label>
              </div>
              {front.sourceName && (
                <div className="grid grid-cols-2 gap-2">
                  <label className={label}>
                    Janela: início
                    <input type="date" name="janela_inicio" required defaultValue={front.janelaInicio ?? ''} className={smallField} />
                  </label>
                  <label className={label}>
                    Janela: fim
                    <input type="date" name="janela_fim" required defaultValue={front.janelaFim ?? ''} className={smallField} />
                  </label>
                </div>
              )}
              {(['principal', 'secundaria'] as const).map((role) => {
                const metric = role === 'principal' ? front.metricaPrincipal : front.metricaSecundaria
                const target = role === 'principal' ? front.alvoPrincipal : front.alvoSecundaria
                return (
                  <div key={role} className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
                    <label className={label}>
                      Métrica {role === 'principal' ? 'principal' : 'secundária'} da frente
                      <select name={`metrica_${role}`} defaultValue={metric ?? ''} className={smallField}>
                        <option value="">segue a etapa</option>
                        {(Object.keys(PROJECT_RESULTS) as ProjectResult[]).map((option) => (
                          <option key={option} value={option}>
                            {PROJECT_RESULTS[option].cost}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      Meta
                      <input name={`alvo_${role}`} inputMode="decimal" defaultValue={target !== null ? String(target).replace('.', ',') : ''} className={`${smallField} ${mono}`} />
                    </label>
                  </div>
                )
              })}
              <p className="text-[11.5px] text-[var(--ct-text-3)]">Sem meta, a frente segue a meta da etapa, sem alerta próprio. Com métrica e meta, a meta é específica e ganha um vigia próprio.</p>
              <div>
                <button type="submit" className={smallButton}>
                  Salvar frente
                </button>
              </div>
            </form>
          </details>
          <span className="ml-auto">
            <ConfirmDeleteButton
              action={setFrontArchived.bind(null, { ...frontContext, code: front.code }, true)}
              label="Arquivar"
              warning="Arquivar? As campanhas dela ficam no histórico, novas não entram."
            />
          </span>
        </div>
      )}
    </div>
  )
}
