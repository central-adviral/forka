'use client'

import { useState, useTransition } from 'react'
import { toggleSalesFunnelStatus } from './actions'

export function SalesFunnelStatusToggle({
  salesFunnelId,
  clientSlug,
  isActive,
}: {
  salesFunnelId: string
  clientSlug: string
  isActive: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      try {
        await toggleSalesFunnelStatus({ sales_funnel_id: salesFunnelId, is_active: !isActive, client_slug: clientSlug })
      } catch {
        setError('Não foi possível atualizar. Tente de novo.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={isActive}
        aria-label={isActive ? 'Pausar funil' : 'Ativar funil'}
        className={`relative box-border h-6 w-11 flex-shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-60 ${
          isActive ? 'bg-[#4ADE9B]' : 'bg-white/[0.12]'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            isActive ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      {error && <span className="text-[11px] text-[#FF7A73]">{error}</span>}
    </div>
  )
}
