import type { ReactNode } from 'react'

// The prototype's page header: a tool tag and a mono eyebrow, the title, one line on what the page
// is for, the page's actions on the right, and a rule underneath.

const TOOL = {
  painel: { label: 'Painel', className: 'bg-[var(--ct-painel-soft)] text-[var(--ct-painel)]' },
  an: { label: 'Análises', className: 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]' },
  ab: { label: 'Testes', className: 'bg-[var(--ct-ab-soft)] text-[var(--ct-ab)]' },
  config: { label: 'Configurar', className: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]' },
} as const

const mono = 'font-[family-name:var(--font-geist-mono)]'

export function PageHeader({
  tool,
  eyebrow,
  title,
  description,
  actions,
}: {
  tool?: keyof typeof TOOL
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-7">
      <div className="min-w-0">
        {(tool || eyebrow) && (
          <span className="flex flex-wrap items-center gap-2.5">
            {tool && <span className={`${mono} rounded-full px-2 py-0.5 text-[10.5px] ${TOOL[tool].className}`}>{TOOL[tool].label}</span>}
            {eyebrow && <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>{eyebrow}</span>}
          </span>
        )}
        <h1 className="mt-2.5 text-[34px] font-semibold tracking-[-0.045em]">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-sm text-[var(--ct-text-2)]">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** The rounded secondary action the prototype puts in a page header. */
export const headerAction =
  'rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:border-[var(--ct-text-3)] hover:text-[var(--ct-text)]'
