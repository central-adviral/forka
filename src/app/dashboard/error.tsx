'use client'

import { useEffect } from 'react'

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('[dashboard-read-failed]', error)
  }, [error])

  return (
    <div role="alert" className="mx-auto mt-24 flex max-w-md flex-col items-start gap-3 rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-6">
      <b className="text-[15px] text-[var(--ct-text)]">Não foi possível carregar os dados agora</b>
      <p className="text-[13px] text-[var(--ct-text-2)]">
        Uma consulta falhou. Os números não são mostrados pela metade para não parecer um dia sem movimento.
      </p>
      <button type="button" onClick={() => retry()} className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">
        Tentar de novo
      </button>
    </div>
  )
}
