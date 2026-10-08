'use client'

import { useActionState } from 'react'
import type { RulePreview } from './actions'

// The add-rule form with "Prever": the same fields, so the preview shows exactly what saving would do.
export function RuleForm({
  addAction,
  previewAction,
  fieldClass,
  mono,
}: {
  addAction: (formData: FormData) => Promise<void>
  previewAction: (previous: RulePreview | null, formData: FormData) => Promise<RulePreview>
  fieldClass: string
  mono: string
}) {
  const [preview, runPreview, pending] = useActionState(previewAction, null)
  return (
    <form action={addAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select name="kind" defaultValue="include" className={fieldClass} aria-label="Tipo da etiqueta">
          <option value="include">contém</option>
          <option value="exclude">não contém</option>
        </select>
        <input name="value" required placeholder="ex: [MTV-T15][GER]" className={`${fieldClass} ${mono} min-w-[220px]`} aria-label="Texto da etiqueta" />
        <button type="submit" formAction={runPreview} className="text-[12.5px] font-medium text-[var(--ct-text-2)] hover:underline">
          {pending ? 'Prevendo…' : 'Prever'}
        </button>
        <button type="submit" className="text-[12.5px] font-medium text-[var(--ct-accent)] hover:underline">
          + etiqueta
        </button>
      </div>
      {preview && (
        <p role="status" className={`text-[12.5px] ${preview.error ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-2)]'}`}>
          {preview.error ?? preview.text}
        </p>
      )}
    </form>
  )
}
