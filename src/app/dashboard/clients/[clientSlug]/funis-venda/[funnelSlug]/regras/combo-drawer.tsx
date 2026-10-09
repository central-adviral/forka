'use client'

import { useState } from 'react'
import type { CostCombo } from '@/lib/domain/funnel-stages'
import { MEASURE_COLOR, SHORT_RESULT, comboFormula, metaToInput } from '@/lib/domain/stage-canvas'
import type { ComboFields } from './stage-actions'
import type { CanvasStage } from './canvas-types'
import { ConfirmButton, Drawer, DrawerSection, field, label, mono, primaryButton } from './stage-drawer'

export function ComboDrawer({
  combo,
  stages,
  canEdit,
  pending,
  onClose,
  onSave,
  onRemove,
}: {
  /** Null: a new combo, saved only on "Salvar". */
  combo: CostCombo | null
  stages: CanvasStage[]
  canEdit: boolean
  pending: boolean
  onClose: () => void
  onSave: (fields: ComboFields) => void
  onRemove: () => void
}) {
  const firstSale = stages.find((stage) => stage.measure === 'compra')
  const [draft, setDraft] = useState<ComboFields>(() =>
    combo
      ? { name: combo.name, enabled: combo.enabled, stageIds: combo.stageIds, over: combo.over, overStageId: combo.overStageId, meta: metaToInput('lead', combo.meta) }
      : { name: 'Novo custo combinado', enabled: true, stageIds: [], over: firstSale ? 'stage' : 'receita', overStageId: firstSale?.id ?? null, meta: '' }
  )
  const set = (patch: Partial<ComboFields>) => setDraft((current) => ({ ...current, ...patch }))

  return (
    <Drawer eyebrow="Custo combinado" title={combo?.name ?? 'Novo custo combinado'} onClose={onClose}>
      <p className="text-[12.5px] text-[var(--ct-text-3)]">Card extra. Não muda o custo de nenhuma etapa: só mostra a soma que você escolher.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
          <label className={label}>
            Nome
            <input required maxLength={80} value={draft.name} onChange={(event) => set({ name: event.target.value })} className={field} />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--ct-text-2)]">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="accent-[var(--ct-accent)]" />
            Ligado: aparece no Resumo do funil
          </label>
          <DrawerSection title="Somar o gasto de">
            {stages.map((stage) => (
              <label key={stage.id} className="flex items-center gap-2 text-[13px] text-[var(--ct-text-2)]">
                <input
                  type="checkbox"
                  checked={draft.stageIds.includes(stage.id)}
                  onChange={(event) =>
                    set({ stageIds: event.target.checked ? [...draft.stageIds, stage.id] : draft.stageIds.filter((id) => id !== stage.id) })
                  }
                  className="accent-[var(--ct-accent)]"
                />
                <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: MEASURE_COLOR[stage.measure] }} />
                {stage.name}
              </label>
            ))}
          </DrawerSection>
          <DrawerSection title="Dividir por">
            <select
              aria-label="Dividir por"
              value={draft.over === 'receita' ? 'receita' : (draft.overStageId ?? '')}
              onChange={(event) =>
                set(event.target.value === 'receita' ? { over: 'receita', overStageId: null } : { over: 'stage', overStageId: event.target.value })
              }
              className={field}
            >
              <option value="receita">receita (vira ROAS)</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {SHORT_RESULT[stage.measure]} de {stage.name}
                </option>
              ))}
            </select>
            <label className={label}>
              Meta (opcional)
              <input
                inputMode="decimal"
                value={draft.meta}
                placeholder={draft.over === 'receita' ? 'ROAS mínimo' : 'custo máximo'}
                onChange={(event) => set({ meta: event.target.value })}
                className={`${field} ${mono}`}
              />
            </label>
            <p className={`${mono} text-[12px] text-[var(--ct-text-3)]`}>{comboFormula(draft, stages)}</p>
          </DrawerSection>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={primaryButton}>
                {pending ? 'Salvando…' : 'Salvar'}
              </button>
              {combo && <ConfirmButton label="Apagar card" warning="Apagar este custo combinado?" onConfirm={onRemove} disabled={pending} />}
            </div>
          )}
        </fieldset>
      </form>
    </Drawer>
  )
}
