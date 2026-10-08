'use client'

import { useState, useTransition } from 'react'
import type { IntegrationCheck } from './actions'

export function TestIntegrationsButton({ testAction }: { testAction: () => Promise<IntegrationCheck[]> }) {
  const [checks, setChecks] = useState<IntegrationCheck[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  function run() {
    setFailed(false)
    startTransition(async () => {
      try {
        setChecks(await testAction())
      } catch {
        setFailed(true)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="self-start rounded-md border border-[var(--ct-line-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)] disabled:opacity-60"
      >
        {pending ? 'Testando…' : 'Testar integração'}
      </button>
      {failed && <p className="text-[12px] text-[var(--ct-crit)]">Não foi possível testar agora. Só gestor ou owner pode testar.</p>}
      {checks && (
        <ul role="status" className="flex flex-col gap-1 text-[12.5px]">
          {checks.map((check) => (
            <li key={check.name} className={check.ok ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-crit)]'}>
              <b>{check.name}:</b> <span className="text-[var(--ct-text-2)]">{check.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
