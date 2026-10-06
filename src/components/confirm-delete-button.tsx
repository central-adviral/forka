'use client'

import { useState } from 'react'

export function ConfirmDeleteButton({
  action,
  label = 'Excluir',
  warning,
}: {
  action: () => Promise<void>
  label?: string
  warning?: string
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-[var(--ct-crit)] hover:text-[var(--ct-crit)]"
      >
        {label}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[var(--ct-crit)]">{warning ?? 'Confirmar?'}</span>
      <form action={action}>
        <button type="submit" className="text-xs font-semibold text-[var(--ct-crit)] underline">
          Sim
        </button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[var(--ct-text-2)]">
        Não
      </button>
    </span>
  )
}
