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
        className="text-xs font-medium text-[#F76C6C] hover:text-[#ff8f8f]"
      >
        {label}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[#F76C6C]">{warning ?? 'Confirmar?'}</span>
      <form action={action}>
        <button type="submit" className="text-xs font-semibold text-[#F76C6C] underline">
          Sim
        </button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[#8A90A6]">
        Não
      </button>
    </span>
  )
}
