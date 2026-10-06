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
        className="text-xs font-medium text-[#FF7A73] hover:text-[#ff8f8f]"
      >
        {label}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[#FF7A73]">{warning ?? 'Confirmar?'}</span>
      <form action={action}>
        <button type="submit" className="text-xs font-semibold text-[#FF7A73] underline">
          Sim
        </button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[#A1A1AA]">
        Não
      </button>
    </span>
  )
}
