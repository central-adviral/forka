'use client'

import { useState, useTransition } from 'react'
import { toggleTestStatus } from './actions'

export function TestStatusToggle({
  testId,
  clientSlug,
  status,
}: {
  testId: string
  clientSlug: string
  status: 'active' | 'paused'
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isActive = status === 'active'

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      try {
        await toggleTestStatus({
          test_id: testId,
          next_status: isActive ? 'paused' : 'active',
          client_slug: clientSlug,
        })
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
        aria-label={isActive ? 'Pausar teste' : 'Ativar teste'}
        className={`relative box-border h-6 w-11 flex-shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-60 ${
          isActive ? 'bg-[var(--ct-ok)]' : 'bg-[var(--ct-surface-2)]'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            isActive ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      {error && <span className="text-[11px] text-[var(--ct-crit)]">{error}</span>}
    </div>
  )
}
