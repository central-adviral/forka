'use client'

import { useActionState, useState } from 'react'
import { MEASURE_COLOR, cleanTag } from '@/lib/domain/stage-canvas'
import type { FunnelModelKey, PlannedStage } from '@/lib/domain/new-funnel'
import { createFunnel, type NewFunnelState } from './actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'min-h-11 w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)] disabled:opacity-60'
const label = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[var(--ct-text-2)]'

export function NewFunnelForm({
  context,
  models,
  funnels,
}: {
  context: { client_id: string; client_slug: string }
  models: { key: FunnelModelKey; name: string; text: string; stages: PlannedStage[] }[]
  funnels: { id: string; name: string }[]
}) {
  const [state, submit, pending] = useActionState<NewFunnelState, FormData>(createFunnel.bind(null, context), { error: null })
  const [tag, setTag] = useState('')
  const [model, setModel] = useState<FunnelModelKey>(models[0].key)
  const [source, setSource] = useState('')

  return (
    <form action={submit} className="card-shadow flex flex-col gap-5 rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-6">
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
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {models.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] px-4 py-3.5 hover:border-[var(--ct-line-2)] has-[:checked]:border-[var(--ct-accent)] has-[:checked]:bg-[var(--ct-accent-soft)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ct-accent)]"
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="model" value={option.key} checked={model === option.key} onChange={() => setModel(option.key)} className="sr-only" />
                <b className="text-[14.5px] font-semibold">{option.name}</b>
              </span>
              <span className="text-[12.5px] text-[var(--ct-text-2)]">{option.text}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
                {option.stages.map((stage, index) => (
                  <span key={stage.name} className="inline-flex items-center gap-1.5">
                    {index > 0 && !stage.parallel && (
                      <span aria-hidden="true" className="text-[var(--ct-text-3)]">
                        →
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2 py-0.5">
                      <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: MEASURE_COLOR[stage.measure] }} />
                      {stage.name}
                      {stage.parallel && <span className="text-[var(--ct-text-3)]">(paralela)</span>}
                    </span>
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-full bg-[var(--ct-accent)] px-5 py-2.5 text-[13.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110 disabled:opacity-60">
          {pending ? 'Criando…' : source ? 'Criar a partir do anterior' : 'Criar e montar etapas'}
        </button>
        <span className="text-[12.5px] text-[var(--ct-text-3)]">O funil nasce em rascunho e abre em Etapas e frentes. Produtos e metas vêm logo depois, no checklist.</span>
      </div>
    </form>
  )
}
