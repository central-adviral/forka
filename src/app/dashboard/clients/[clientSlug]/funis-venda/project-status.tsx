'use client'

import { useState, useTransition } from 'react'
import { setProjectStatus } from './actions'
import type { ProjectStatus } from '@/lib/domain/new-funnel'

// The project's lifecycle (0102): rascunho -> rodando -> encerrado, and Reabrir back to rodando.

const TONE: Record<ProjectStatus, string> = {
  rascunho: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
  rodando: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]',
  encerrado: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]',
}
const HINT: Record<ProjectStatus, string> = {
  rascunho: 'Sem sincronizar e sem alertas.',
  rodando: 'Sincroniza, vigia e alerta.',
  encerrado: 'Sem sync: números congelados.',
}
const NEXT: Record<ProjectStatus, { to: ProjectStatus; label: string; confirm?: string }> = {
  rascunho: { to: 'rodando', label: 'Ligar' },
  rodando: { to: 'encerrado', label: 'Encerrar', confirm: 'Encerrar o funil? O sync e os vigias param e os números ficam como estão.' },
  encerrado: { to: 'rodando', label: 'Reabrir' },
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span title={HINT[status]} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE[status]}`}>
      {status}
    </span>
  )
}

export function ProjectStatusActions({ salesFunnelId, status, canEdit }: { salesFunnelId: string; status: ProjectStatus; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const next = NEXT[status]

  function move() {
    if (next.confirm && !window.confirm(next.confirm)) return
    setError(null)
    startTransition(async () => {
      try {
        await setProjectStatus({ sales_funnel_id: salesFunnelId, status: next.to })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível mudar o estado. Tente de novo.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <ProjectStatusChip status={status} />
        {canEdit && (
          <button
            type="button"
            onClick={move}
            disabled={isPending}
            className="min-h-[32px] rounded-full border border-[var(--ct-line-2)] px-3 text-[12.5px] font-medium text-[var(--ct-text)] hover:bg-[var(--ct-surface-2)] disabled:opacity-60"
          >
            {next.label}
          </button>
        )}
      </div>
      {error && (
        <span role="alert" className="max-w-[280px] text-right text-[11px] text-[var(--ct-crit)]">
          {error}
        </span>
      )}
    </div>
  )
}
