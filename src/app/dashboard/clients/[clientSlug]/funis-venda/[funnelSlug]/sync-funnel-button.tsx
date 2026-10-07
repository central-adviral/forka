'use client'

import { useState, useTransition } from 'react'
import { syncFunnelNow } from '../actions'

export function SyncFunnelButton({
  salesFunnelId,
  clientSlug,
  funnelSlug,
}: {
  salesFunnelId: string
  clientSlug: string
  funnelSlug: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [justSynced, setJustSynced] = useState(false)

  function handleClick() {
    setError(null)
    setJustSynced(false)
    startTransition(async () => {
      try {
        await syncFunnelNow({ sales_funnel_id: salesFunnelId, client_slug: clientSlug, funnel_slug: funnelSlug })
        setJustSynced(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível atualizar.')
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-[var(--ct-crit)]">{error}</span>}
      {justSynced && !isPending && <span className="text-[11px] text-[var(--ct-ok)]">Atualizado</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)] disabled:opacity-60"
      >
        {isPending ? 'Atualizando...' : 'Atualizar agora'}
      </button>
    </div>
  )
}
