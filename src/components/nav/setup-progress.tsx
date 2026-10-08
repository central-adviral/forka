'use client'

import Link from 'next/link'
import type { SetupView } from '@/lib/nav/nav-config'

/** "4/5 · Falta configurar Metas →" at the top of the sidebar; gone once the project is 5/5. */
export function SetupNotice({ setup, href, onNavigate }: { setup: SetupView | undefined; href: string | null; onNavigate?: () => void }) {
  if (!setup || !href || setup.done === setup.total || !setup.nextLabel) return null
  const percent = Math.round((setup.done / setup.total) * 100)
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={`${setup.done} de ${setup.total} passos configurados. Falta configurar ${setup.nextLabel}.`}
      className="relative flex min-h-[40px] w-full items-center gap-2.5 overflow-hidden rounded-[10px] bg-[var(--ct-warn-soft)] px-3 py-2 text-[var(--ct-warn)] hover:brightness-105"
    >
      <span className="font-[family-name:var(--font-geist-mono)] text-[12px] font-semibold">
        {setup.done}/{setup.total}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Falta configurar {setup.nextLabel}</span>
      <span aria-hidden="true" className="text-[13px]">
        →
      </span>
      <span aria-hidden="true" className="absolute bottom-0 left-0 h-[3px] bg-[var(--ct-warn)]" style={{ width: `${percent}%` }} />
    </Link>
  )
}
