'use client'

import { useActionState, useState } from 'react'
import { checkFindings, type PageSuggestion } from '@/lib/domain/page-probe'
import type { TestPageResult } from './actions'

const field =
  'min-h-11 w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const step = 'flex flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-5'
const stepTitle = 'text-[14px] font-semibold'

export interface PageFormValues {
  label: string
  url: string
  salesFunnelId: string | null
  watchPixel: boolean
  watchCheckout: boolean
  requiredText: string | null
}

export function PageForm({
  initial,
  projects,
  suggestions,
  slotsUsed,
  maxSlots,
  editing,
  saveAction,
  testAction,
}: {
  initial: PageFormValues
  projects: { id: string; name: string }[]
  suggestions: PageSuggestion[]
  /** Active pages counting this one once saved. */
  slotsUsed: number
  maxSlots: number
  editing: boolean
  saveAction: (formData: FormData) => Promise<void>
  testAction: (previous: TestPageResult | null, formData: FormData) => Promise<TestPageResult>
}) {
  const [tested, runTest, testing] = useActionState(testAction, null)
  const [url, setUrl] = useState(initial.url)
  const [label, setLabel] = useState(initial.label)
  const [seen, setSeen] = useState(tested)
  // The page's <title> fills the name once, only when the name is still empty.
  if (tested !== seen) {
    setSeen(tested)
    if (!label && tested?.result?.title) setLabel(tested.result.title)
  }
  const result = tested?.result
  const findings = result
    ? checkFindings(
        { ...result, checkedAt: new Date().toISOString() },
        { watchPixel: true, watchCheckout: true, requiredText: null },
        new Date()
      )
    : []

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={saveAction} className="flex flex-col gap-5">
        <section className={step} aria-labelledby="passo-endereco">
          <h2 id="passo-endereco" className={stepTitle}>1. Endereço</h2>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Endereço da página (https)
            <span className="flex flex-wrap gap-2">
              <input
                name="url"
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://..."
                className={`${field} min-w-[240px] flex-1`}
              />
              <button
                type="submit"
                formAction={runTest}
                formNoValidate
                disabled={testing || !url}
                className="min-h-11 rounded-[10px] border border-[var(--ct-line-2)] px-4 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)] disabled:opacity-50"
              >
                {testing ? 'Testando...' : 'Testar agora'}
              </button>
            </span>
          </label>
          <div aria-live="polite">
            {tested?.error && <p className="text-[12.5px] text-[var(--ct-crit)]">{tested.error}</p>}
            {result && !testing && (
              <ul className="flex flex-col gap-1.5 text-[12.5px]">
                {findings.map((finding) => (
                  <li key={finding.id} className="flex items-start gap-2">
                    <span className={`mt-0.5 rounded-full px-1.5 text-[10.5px] font-semibold ${finding.ok ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]'}`}>
                      {finding.ok ? 'ok' : 'atenção'}
                    </span>
                    <span>
                      <b className="font-medium">{finding.label}</b> <span className="text-[var(--ct-text-2)]">{finding.detail}</span>
                    </span>
                  </li>
                ))}
                {result.ok && (
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-[var(--ct-surface-3)] px-1.5 text-[10.5px] font-semibold text-[var(--ct-text-2)]">título</span>
                    <span className="text-[var(--ct-text-2)]">{result.title ?? 'a página não tem título'}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        <section className={step} aria-labelledby="passo-nome">
          <h2 id="passo-nome" className={stepTitle}>2. Nome e projeto</h2>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Nome
            <input name="label" required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="ex.: Página de vendas 1K" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Projeto que manda tráfego para ela
            <select name="sales_funnel_id" defaultValue={initial.salesFunnelId ?? ''} className={field}>
              <option value="">Nenhum</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <span>Com o projeto, a sonda mostra o gasto que chega à página e quanto custa uma queda.</span>
          </label>
        </section>

        <section className={step} aria-labelledby="passo-vigiar">
          <h2 id="passo-vigiar" className={stepTitle}>3. O que vigiar</h2>
          <p className="text-[12px] text-[var(--ct-text-3)]">Se abre, os redirecionamentos, o tempo do servidor e o certificado são sempre conferidos.</p>
          <label className="flex min-h-11 items-center gap-3 text-[13px]">
            <input type="checkbox" name="watch_pixel" defaultChecked={initial.watchPixel} className="h-5 w-5 accent-[var(--ct-accent)]" />
            Pixel do Meta na página
          </label>
          <label className="flex min-h-11 items-center gap-3 text-[13px]">
            <input type="checkbox" name="watch_checkout" defaultChecked={initial.watchCheckout} className="h-5 w-5 accent-[var(--ct-accent)]" />
            Botão de compra leva a um checkout da Hubla que responde
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Texto que precisa estar na página (opcional)
            <input name="required_text" maxLength={120} defaultValue={initial.requiredText ?? ''} placeholder="ex.: R$ 497" className={field} />
            <span>Sem diferença de maiúsculas. Em branco, não confere.</span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="min-h-11 rounded-[10px] bg-[var(--ct-accent)] px-5 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
            {editing ? 'Salvar' : 'Pôr na sonda'}
          </button>
          <span className="text-[12.5px] text-[var(--ct-text-3)]">
            {editing ? `${slotsUsed} de ${maxSlots} vagas usadas` : `Vai usar ${slotsUsed} de ${maxSlots} vagas`}
          </span>
        </div>
      </form>

      {suggestions.length > 0 && (
        <aside className="flex flex-col gap-3 self-start rounded-[14px] border border-[var(--ct-line)] p-5" aria-labelledby="sugestoes">
          <h2 id="sugestoes" className={stepTitle}>Sugestões dos testes A/B</h2>
          <p className="text-[12px] text-[var(--ct-text-3)]">Páginas para onde seus testes mandam gente e que a sonda ainda não olha.</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.url}>
                <button
                  type="button"
                  onClick={() => setUrl(suggestion.url)}
                  className="flex min-h-11 w-full flex-col items-start rounded-[10px] border border-[var(--ct-line-2)] px-3 py-2 text-left hover:border-[var(--ct-accent)]"
                >
                  <span className="w-full truncate text-[12.5px] font-medium">{suggestion.url}</span>
                  <span className="text-[11.5px] text-[var(--ct-text-3)]">{suggestion.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}
