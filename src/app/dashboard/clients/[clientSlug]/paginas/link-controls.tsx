'use client'

import { useId, useState, useTransition } from 'react'
import { linkValue, parseLinkValue, type LinkOptionGroup, type PageLink } from '@/lib/domain/page-links'
import { linkPage } from './actions'

interface Context {
  client_id: string
  client_slug: string
}

const select =
  'min-h-11 max-w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface)] px-2.5 text-[12.5px] text-[var(--ct-text)] disabled:opacity-60'

function useLink(context: Context) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function link(pageId: string, target: PageLink, onError?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await linkPage({ ...context, page_id: pageId }, { sales_funnel_id: target.salesFunnelId, front_id: target.frontId })
        if (result.error) {
          setError(result.error)
          onError?.()
        }
      } catch {
        setError('Não foi possível ligar a página. Tente de novo.')
        onError?.()
      }
    })
  }
  return { pending, error, link }
}

function Status({ id, pending, error }: { id: string; pending: boolean; error: string | null }) {
  return (
    <span id={id} role={error ? 'alert' : 'status'} className={`text-[11.5px] ${error ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-3)]'}`}>
      {error ?? (pending ? 'Salvando…' : '')}
    </span>
  )
}

function Groups({ groups }: { groups: LinkOptionGroup[] }) {
  return groups.map((group) => (
    <optgroup key={group.label} label={group.label}>
      {group.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </optgroup>
  ))
}

/** "Ligar a" on a page row: saves on change. */
export function PageLinkSelect({
  context,
  pageId,
  current,
  currentLabel,
  groups,
}: {
  context: Context
  pageId: string
  current: PageLink
  /** Where the page is now, shown when that place is archived and so not among the choices. */
  currentLabel: string
  groups: LinkOptionGroup[]
}) {
  const id = useId()
  const saved = linkValue(current)
  const [value, setValue] = useState(saved)
  const { pending, error, link } = useLink(context)
  const listed = saved === '|' || groups.some((group) => group.options.some((option) => option.value === saved))

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 pb-3 text-[11.5px] text-[var(--ct-text-3)]">
      <label htmlFor={id}>Ligar a</label>
      <select
        id={id}
        value={value}
        disabled={pending}
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          setValue(event.target.value)
          link(pageId, parseLinkValue(event.target.value), () => setValue(saved))
        }}
        className={select}
      >
        {!listed && (
          <option value={saved} disabled>
            {currentLabel} (arquivado)
          </option>
        )}
        <Groups groups={groups} />
        <option value="|">Sem funil</option>
      </select>
      <Status id={`${id}-status`} pending={pending} error={error} />
    </div>
  )
}

/** "Ligar página já cadastrada" on a front with spend and no page: links the chosen page to this front. */
export function FrontLinkSelect({
  context,
  salesFunnelId,
  frontId,
  groups,
}: {
  context: Context
  salesFunnelId: string
  frontId: string
  groups: LinkOptionGroup[]
}) {
  const id = useId()
  const { pending, error, link } = useLink(context)
  if (groups.length === 0) return null

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor={id} className="sr-only">
        Ligar página já cadastrada a esta frente
      </label>
      <select
        id={id}
        value=""
        disabled={pending}
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          if (event.target.value) link(event.target.value, { salesFunnelId, frontId })
        }}
        className={select}
      >
        <option value="" disabled>
          Ligar página já cadastrada…
        </option>
        <Groups groups={groups} />
      </select>
      <Status id={`${id}-status`} pending={pending} error={error} />
    </span>
  )
}
