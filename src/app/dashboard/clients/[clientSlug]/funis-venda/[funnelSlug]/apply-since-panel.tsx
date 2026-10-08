'use client'

import { useActionState } from 'react'
import type { ApplySincePreview } from './apply-since-actions'

// Shown after a product or rule change: the change holds from now on, and the past only changes
// here, after "Prever" shows what "Aplicar" would do for that same date.
export function ApplySincePanel({
  previewAction,
  applyAction,
  today,
  fieldClass,
}: {
  previewAction: (previous: ApplySincePreview | null, formData: FormData) => Promise<ApplySincePreview>
  applyAction: (formData: FormData) => Promise<void>
  today: string
  fieldClass: string
}) {
  const [preview, runPreview, pending] = useActionState(previewAction, null)
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-[22px] py-4">
      <p className="text-[13px] text-[var(--ct-text-2)]">
        Vale a partir de agora: vendas e campanhas que já aconteceram ficam como estavam. Para refazer o passado com a configuração atual:
      </p>
      <form action={runPreview} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--ct-text-2)]">
          Aplicar desde
          <input type="date" name="since" required max={today} defaultValue={today} className={fieldClass} />
        </label>
        <button type="submit" className="text-[12.5px] font-medium text-[var(--ct-text-2)] hover:underline">
          {pending ? 'Prevendo…' : 'Prever'}
        </button>
      </form>
      {preview && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className={`text-[12.5px] ${preview.error ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-2)]'}`}>
            {preview.error ?? preview.text}
          </p>
          {preview.since && (
            <form action={applyAction}>
              <input type="hidden" name="since" value={preview.since} />
              <button type="submit" className="text-[12.5px] font-medium text-[var(--ct-accent)] hover:underline">
                Aplicar
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
