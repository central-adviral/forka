'use client'

import type { ReactNode } from 'react'
import { useNavHeading } from './nav/nav-context'

// Every page's header, fed by the same nav config as the sidebar: a small "GRUPO · SEÇÃO" line, the
// subsection as the title, the section's "what is this for" line, the page's note, and the page's
// actions on the right. A page that is no subsection (a test report, a form) keeps its own title.

const mono = 'font-[family-name:var(--font-geist-mono)]'

export function PageHeader({
  title,
  description,
  note,
  actions,
}: {
  /** Used when the page is not a subsection of the navigation. */
  title?: ReactNode
  description?: ReactNode
  /** Page-specific facts that sit under the purpose line (data cut-off, client name). */
  note?: ReactNode
  actions?: ReactNode
}) {
  const heading = useNavHeading()
  const isSubsection = Boolean(heading?.sub)
  const shownTitle = heading?.sub ?? title ?? heading?.section
  const shownDescription = isSubsection ? heading!.help : (description ?? heading?.help)

  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-7">
      <div className="min-w-0">
        {heading && (
          <span className={`${mono} text-[11px] uppercase tracking-[0.08em] text-[var(--ct-accent)]`}>
            {heading.group} · {heading.section}
          </span>
        )}
        <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[34px]">{shownTitle}</h1>
        {shownDescription && <p className="mt-2 max-w-[64ch] text-sm text-[var(--ct-text-2)]">{shownDescription}</p>}
        {note && <p className="mt-1.5 max-w-[64ch] text-[12.5px] text-[var(--ct-text-3)]">{note}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
