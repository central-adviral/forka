'use client'

import Link from 'next/link'
import type { NavSection } from '@/lib/nav/nav-config'
import { afterAnchorClick } from './nav-section'

/** Below lg the sidebar is a drawer, so the open section's subsections come back as scrollable tabs. */
export function SectionTabs({ section }: { section: NavSection | null }) {
  if (!section || section.subs.length < 2) return null
  return (
    <nav aria-label={`Subseções de ${section.label}`} className="mx-3 mt-3 overflow-x-auto lg:hidden">
      <ul className="flex w-max gap-1 rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-1">
        {section.subs.map((sub) => (
          <li key={sub.id}>
            <Link
              href={sub.href}
              onClick={() => afterAnchorClick(sub.href)}
              aria-current={sub.active ? 'page' : undefined}
              className={`block whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                sub.active ? 'bg-[var(--ct-surface)] text-[var(--ct-text)] shadow-[0_0_0_1px_var(--ct-line-2)]' : 'text-[var(--ct-text-2)]'
              }`}
            >
              {sub.label}
              {sub.count !== null && <span className="ml-1.5 font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-3)]">{sub.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
