'use client'

import Link from 'next/link'
import type { NavBadge, NavIcon, NavSection, NavTone } from '@/lib/nav/nav-config'
import { announceHashChange } from './nav-context'

// Inlined glyphs (the prototype's set): six icons at one size don't justify an icon package.
const GLYPHS: Record<NavIcon, React.ReactNode> = {
  hoje: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  alertas: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />,
  desempenho: <path d="M4 20V11M10 20V5M16 20v-6M21 20H3" />,
  testes: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" />,
  projeto: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  cliente: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
}

export function NavGlyph({ icon }: { icon: NavIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[icon]}
    </svg>
  )
}

export const TONE_PILL: Record<NavTone, string> = {
  crit: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]',
  warn: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
  ok: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]',
  info: 'bg-[var(--ct-accent-soft)] text-[var(--ct-accent)]',
}
export const TONE_DOT: Record<NavTone, string> = {
  crit: 'bg-[var(--ct-crit)]',
  warn: 'bg-[var(--ct-warn)]',
  ok: 'bg-[var(--ct-ok)]',
  info: 'bg-[var(--ct-accent)]',
}

const mono = 'font-[family-name:var(--font-geist-mono)]'

function Badge({ badge }: { badge: NavBadge }) {
  return (
    <span className={`${mono} ml-auto flex-none rounded-full px-2 py-px text-[11px] ${TONE_PILL[badge.tone]}`}>
      <span aria-hidden="true">{badge.text}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  )
}

// Same-page anchors move with pushState: tell the shell once the URL has the new hash.
export function afterAnchorClick(href: string) {
  if (href.includes('#')) setTimeout(announceHashChange, 0)
}

export function NavSectionItem({ section, collapsed, onNavigate }: { section: NavSection; collapsed: boolean; onNavigate?: () => void }) {
  const open = section.active && !collapsed
  const alertTone = section.badge && (section.badge.tone === 'crit' || section.badge.tone === 'warn') ? section.badge.tone : null

  if (collapsed) {
    return (
      <Link
        href={section.href}
        onClick={() => {
          afterAnchorClick(section.href)
          onNavigate?.()
        }}
        aria-current={section.active ? 'page' : undefined}
        aria-label={section.badge ? `${section.label}, ${section.badge.label}` : section.label}
        title={section.label}
        className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-[12px] px-0.5 py-2 text-center ${
          section.active ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-accent)]' : 'text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]'
        }`}
      >
        <span className="relative grid h-5 w-5 place-items-center">
          <NavGlyph icon={section.icon} />
          {alertTone && <span className={`absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--ct-surface)] ${TONE_DOT[alertTone]}`} />}
        </span>
        <span className="text-[10.5px] font-semibold leading-tight">{section.short}</span>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Link
        href={section.href}
        onClick={() => {
          afterAnchorClick(section.href)
          onNavigate?.()
        }}
        aria-current={section.active && !section.subs.some((sub) => sub.active) ? 'page' : undefined}
        aria-expanded={open}
        className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[14px] ${
          section.active ? 'bg-[var(--ct-accent-soft)] font-semibold text-[var(--ct-text)]' : 'font-medium text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]'
        }`}
      >
        <NavGlyph icon={section.icon} />
        <span className="min-w-0 flex-1 truncate">{section.label}</span>
        {section.badge && <Badge badge={section.badge} />}
        <span aria-hidden="true" className={`text-[15px] leading-none text-[var(--ct-text-3)] transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </Link>
      {open && (
        <ul className="mb-1.5 ml-[21px] mt-0.5 flex flex-col gap-px border-l-[1.5px] border-[var(--ct-line-2)] pl-3">
          {section.subs.map((sub) => (
            <li key={sub.id}>
              <Link
                href={sub.href}
                onClick={() => {
                  afterAnchorClick(sub.href)
                  onNavigate?.()
                }}
                aria-current={sub.active ? 'page' : undefined}
                className={`flex w-full flex-col gap-px rounded-[9px] px-2.5 py-1.5 text-left ${
                  sub.active ? 'bg-[var(--ct-surface)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--ct-accent)_40%,transparent)]' : 'hover:bg-[var(--ct-surface-2)]'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  {sub.status && (
                    <span className={`h-[7px] w-[7px] flex-none rounded-full ${TONE_DOT[sub.status]}`}>
                      <span className="sr-only">{sub.status === 'ok' ? 'configurado' : 'falta configurar'}</span>
                    </span>
                  )}
                  <span className={`text-[13.5px] ${sub.active ? 'font-semibold text-[var(--ct-text)]' : 'font-medium text-[var(--ct-text-2)]'}`}>{sub.label}</span>
                  {sub.count !== null && <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>{sub.count}</span>}
                </span>
                {sub.active && <span className="text-[12px] leading-snug text-[var(--ct-text-3)]">{sub.desc}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
