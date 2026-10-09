'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { cleanTag, MEASURE_COLOR, type FunnelResultLine } from '@/lib/domain/stage-canvas'
import type { ProjectStatus } from '@/lib/domain/new-funnel'
import { saveFunnelHeader, type HeaderChange, type HeaderContext } from './funnel-header-actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'min-h-10 w-full min-w-0 rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)] disabled:opacity-70'
const caption = `${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`

const STATUS_LABEL: Record<ProjectStatus, string> = { rascunho: 'Rascunho', rodando: 'Rodando', encerrado: 'Encerrado' }
const STATUS_HINT: Record<ProjectStatus, string> = {
  rascunho: 'Sem sincronizar e sem alertas.',
  rodando: 'Sincroniza, vigia e alerta.',
  encerrado: 'Sem sync: números congelados.',
}

interface Values {
  name: string
  tag: string
  status: ProjectStatus
  startsOn: string
  endsOn: string
}

export function FunnelHeaderForm({
  context,
  initial,
  result,
  canEdit,
  regrasHref,
}: {
  context: HeaderContext
  initial: Values
  result: FunnelResultLine | null
  canEdit: boolean
  regrasHref: string
}) {
  const [values, setValues] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function save(change: HeaderChange, next: Partial<Values>) {
    setMessage(null)
    startTransition(async () => {
      const { error } = await saveFunnelHeader(context, change)
      if (error) {
        setMessage({ tone: 'erro', text: error })
        // The status and the window snap back; the name and tag keep what was typed to fix it.
        if (change.field === 'status' || change.field === 'window') setValues((current) => ({ ...current, status: saved.status, startsOn: saved.startsOn, endsOn: saved.endsOn }))
        return
      }
      setSaved((current) => ({ ...current, ...next }))
      setMessage({ tone: 'ok', text: 'Salvo.' })
    })
  }

  const saveText = (key: 'name' | 'tag') => {
    const value = values[key].trim()
    if (value === saved[key]) return
    if (key === 'name' && !value) {
      setValues((current) => ({ ...current, name: saved.name }))
      return
    }
    save({ field: key, value }, { [key]: value })
  }

  const saveWindow = (startsOn: string, endsOn: string) => {
    setValues((current) => ({ ...current, startsOn, endsOn }))
    save({ field: 'window', value: { starts_on: startsOn, ends_on: endsOn } }, { startsOn, endsOn })
  }

  return (
    <section aria-label="Funil" className="card-shadow flex flex-col gap-2 rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
      <div className="grid items-end gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] lg:[grid-template-columns:minmax(200px,1.6fr)_minmax(130px,0.8fr)_minmax(130px,0.8fr)_minmax(250px,1.4fr)_minmax(220px,1.4fr)]">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={caption}>Funil</span>
          <input
            value={values.name}
            maxLength={80}
            required
            disabled={!canEdit}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            onBlur={() => saveText('name')}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            className={`${field} font-semibold`}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={caption}>Etiqueta do funil</span>
          <input
            value={values.tag}
            maxLength={24}
            placeholder="ex.: MENT26"
            spellCheck={false}
            disabled={!canEdit}
            aria-describedby="funnel-tag-hint"
            onChange={(event) => setValues({ ...values, tag: cleanTag(event.target.value) ?? '' })}
            onBlur={() => saveText('tag')}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            className={`${field} ${mono}`}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={caption}>Status</span>
          <select
            value={values.status}
            disabled={!canEdit || pending}
            title={STATUS_HINT[values.status]}
            onChange={(event) => {
              const status = event.target.value as ProjectStatus
              if (status === 'encerrado' && !window.confirm('Encerrar o funil? O sync e os vigias param e os números ficam como estão.')) return
              setValues({ ...values, status })
              save({ field: 'status', value: status }, { status })
            }}
            className={field}
          >
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex min-w-0 flex-col gap-1" disabled={!canEdit}>
          <legend className={`${caption} mb-1`}>Janela</legend>
          <div className="grid grid-cols-2 gap-1.5">
            <input type="date" aria-label="Início do funil" value={values.startsOn} onChange={(event) => saveWindow(event.target.value, values.endsOn)} className={field} />
            <input type="date" aria-label="Fim do funil" value={values.endsOn} onChange={(event) => saveWindow(values.startsOn, event.target.value)} className={field} />
          </div>
        </fieldset>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={caption}>Resultado do funil · automático</span>
          {result ? (
            <p className="flex min-h-10 flex-wrap items-center gap-x-1.5 text-[13.5px]">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MEASURE_COLOR[result.measure] }} />
              <b className="font-semibold">{result.cost}</b>
              {result.meta ? <span className={mono}>{result.meta}</span> : <span className="text-[var(--ct-warn)]">sem meta</span>}
              <Link href={regrasHref} className="text-[12.5px] text-[var(--ct-text-3)] hover:text-[var(--ct-accent)] hover:underline">
                · etapa {result.stageName}
              </Link>
            </p>
          ) : (
            <Link href={regrasHref} className="flex min-h-10 items-center text-[13px] text-[var(--ct-warn)] hover:underline">
              Monte uma etapa na sequência
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ct-text-3)]">
        <span id="funnel-tag-hint">A etiqueta do funil vai no nome de toda campanha dele e evita que dois funis do cliente disputem a mesma campanha.</span>
        <span className="sr-only" aria-live="polite">
          {pending ? 'Salvando.' : message?.tone === 'ok' ? message.text : ''}
        </span>
        {!pending && message?.tone === 'ok' && <span className="text-[var(--ct-ok)]" aria-hidden="true">{message.text}</span>}
        {pending && <span aria-hidden="true">Salvando…</span>}
        {!canEdit && <span>Somente leitura.</span>}
      </div>
      {message?.tone === 'erro' && (
        <p role="alert" className="text-[12.5px] text-[var(--ct-crit)]">
          {message.text}
        </p>
      )}
    </section>
  )
}
