'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandPalette, type CommandItem } from './command-palette'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'
import type { ClientRole } from '@/lib/repo/client-access-repo'
import { NAV_RAIL_COOKIE, buildNav, navHeading, projectFromUrl, projectSwitchHref, resolveActive, type NavCounts } from '@/lib/nav/nav-config'
import { Sidebar, type SidebarProject } from './nav/sidebar'
import { SectionTabs } from './nav/section-tabs'
import { NavHeadingContext, useLocationHash } from './nav/nav-context'

export type ShellProject = SidebarProject

interface Client {
  id: string
  name: string
  slug: string
  projects: ShellProject[]
  role: ClientRole
}

const ROLE_LABEL: Record<ClientRole, string> = {
  owner: 'Owner',
  gestor: 'Gestor',
  analista: 'Analista',
  cliente: 'Cliente · leitura',
}

// Dark by default; the choice lives in localStorage and is applied before paint by the root layout.
function toggleTheme() {
  const root = document.documentElement
  const next = root.dataset.mode === 'light' ? 'dark' : 'light'
  if (next === 'light') root.dataset.mode = 'light'
  else delete root.dataset.mode
  try {
    localStorage.setItem('ct-mode', next)
  } catch {}
}

function rememberRail(collapsed: boolean) {
  try {
    document.cookie = collapsed ? `${NAV_RAIL_COOKIE}=1; path=/; max-age=31536000; samesite=lax` : `${NAV_RAIL_COOKIE}=; path=/; max-age=0; samesite=lax`
  } catch {
    // The preference is a convenience: without the cookie the menu just opens expanded next time.
  }
}

export function DashboardShell({
  clients,
  userEmail,
  viewAsClient = false,
  initialCollapsed = false,
  children,
}: {
  clients: Client[]
  userEmail: string
  /** "Ver como cliente" is on (cookie read by the layout). */
  viewAsClient?: boolean
  /** The collapsed rail preference, read from its cookie by the layout so the first paint matches. */
  initialCollapsed?: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const hash = useLocationHash()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [countsByKey, setCountsByKey] = useState<Record<string, NavCounts>>({})

  const activeClient = clients.find(
    (client) => pathname === `/dashboard/clients/${client.slug}` || pathname.startsWith(`/dashboard/clients/${client.slug}/`)
  )
  const base = activeClient ? `/dashboard/clients/${activeClient.slug}` : ''
  const urlProject = activeClient ? projectFromUrl(pathname, search, activeClient.slug) : null
  const project = activeClient
    ? (activeClient.projects.find((item) => item.slug === urlProject) ?? activeClient.projects.find((item) => item.isActive) ?? activeClient.projects[0] ?? null)
    : null
  const realRole = activeClient?.role
  const canPreview = realRole === 'owner' || realRole === 'gestor'
  // While previewing, the shell shows what a client user would see; nothing else changes.
  const previewing = viewAsClient && canPreview
  const role: ClientRole = previewing ? 'cliente' : (realRole ?? 'cliente')
  const active = activeClient ? resolveActive(pathname, search, hash, activeClient.slug) : null

  // Badges for the open client and project. Fetched when either changes (and on focus), never from
  // local nav state; until they arrive the menu simply shows no numbers.
  const countsKey = activeClient ? `${activeClient.slug}|${project?.slug ?? ''}` : ''
  useEffect(() => {
    if (!activeClient) return
    let cancelled = false
    const load = () => {
      const query = new URLSearchParams({ client: activeClient.slug, ...(project ? { projeto: project.slug } : {}) })
      fetch(`/api/nav?${query.toString()}`, { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<NavCounts>) : null))
        .then((counts) => {
          if (!cancelled && counts) setCountsByKey((current) => ({ ...current, [countsKey]: counts }))
        })
        .catch(() => {})
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
    }
    // countsKey already encodes the client and the project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey])
  const counts = countsByKey[countsKey] ?? {}

  const groups = activeClient ? buildNav({ clientSlug: activeClient.slug, role, project: project?.slug ?? null, search, active, counts }) : []
  const activeSection = groups.flatMap((group) => group.sections).find((section) => section.active) ?? null
  const heading = navHeading(active)
  const canConfigure = groups.some((group) => group.id === 'configurar')
  const setupHref = canConfigure && project ? `${base}/funis-venda/${project.slug}/configurar` : null

  function setPreview(on: boolean) {
    document.cookie = on ? 'ct-view-as=cliente; path=/; max-age=86400; samesite=lax' : 'ct-view-as=; path=/; max-age=0; samesite=lax'
    router.refresh()
  }
  async function signOut() {
    await createBrowserSupabaseClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }
  function toggleCollapsed() {
    setCollapsed((current) => {
      rememberRail(!current)
      return !current
    })
  }

  const commandItems: CommandItem[] = [
    ...clients.map((client) => ({ label: client.name, group: 'cliente', href: `/dashboard/clients/${client.slug}` })),
    ...(activeClient
      ? activeClient.projects.map((item) => ({ label: item.name, group: 'funil', href: `${base}/funis-venda/${item.slug}` }))
      : []),
    ...groups.flatMap((group) =>
      group.sections.flatMap((section) => section.subs.map((sub) => ({ label: `${section.label} › ${sub.label}`, group: group.label.toLowerCase(), href: sub.href })))
    ),
    { label: 'Carteira', group: 'agência', href: '/dashboard' },
    { label: 'Novo cliente', group: 'agência', href: '/dashboard/clients/new' },
  ]

  const crumbs: string[] = activeClient
    ? [activeClient.name, ...(project ? [project.name] : []), ...(heading ? [heading.section, ...(heading.sub ? [heading.sub] : [])] : [])]
    : [pathname === '/dashboard/clients/new' ? 'Novo cliente' : 'Carteira']

  const sidebarProps = {
    clients,
    activeClient: activeClient ?? null,
    project,
    projectHref: (slug: string) => projectSwitchHref(base, slug, pathname, search, active),
    groups,
    setup: counts.setup,
    setupHref,
    canPreview,
    canCreateFunnel: role === 'owner' || role === 'gestor',
    previewing,
    onTogglePreview: () => setPreview(!previewing),
    pathname,
  }

  return (
    <div className="flex h-screen font-[family-name:var(--font-manrope)] text-[var(--ct-text)]">
      <aside
        aria-label="Menu"
        className={`hidden flex-none overflow-y-auto border-r border-[var(--ct-line)] bg-[var(--ct-surface)] transition-[width] lg:block ${collapsed ? 'w-[88px]' : 'w-[272px]'}`}
      >
        <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onKeyDown={(event) => event.key === 'Escape' && setDrawerOpen(false)}>
          <button type="button" aria-label="Fechar menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-black/50" />
          <aside id="menu-lateral" aria-label="Menu" className="absolute inset-y-0 left-0 w-[284px] max-w-[85vw] overflow-y-auto border-r border-[var(--ct-line)] bg-[var(--ct-surface)]">
            <Sidebar {...sidebarProps} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-3 border-b border-[var(--ct-line)] bg-[var(--ct-glass)] px-3 py-3 backdrop-blur-md lg:px-8">
          <button
            type="button"
            aria-label="Abrir menu"
            aria-controls="menu-lateral"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="grid h-9 w-9 flex-none place-items-center rounded-[9px] text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)] lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <nav aria-label="Você está em" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[13px] text-[var(--ct-text-3)]">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb}-${index}`} className={`flex min-w-0 items-center gap-1.5 ${index < crumbs.length - 2 ? 'max-sm:hidden' : ''}`}>
                  {index > 0 && <span aria-hidden="true">›</span>}
                  {index === crumbs.length - 1 ? (
                    <b className="truncate font-semibold text-[var(--ct-text)]" aria-current="page">
                      {crumb}
                    </b>
                  ) : (
                    <span className="truncate">{crumb}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <span className="ml-auto flex flex-none items-center gap-2">
            {activeClient && !canPreview && (
              <span className="rounded-full bg-[var(--ct-accent-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--ct-accent)] max-sm:hidden">Somente leitura</span>
            )}
            <CommandPalette items={commandItems} />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Alternar tema claro e escuro"
              className="grid h-9 w-9 place-items-center rounded-[9px] text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]"
            >
              <svg viewBox="0 0 16 16" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
              </svg>
            </button>
            <details className="relative">
              <summary
                className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full bg-[var(--ct-surface-3)] text-xs font-semibold text-[var(--ct-text-2)] [&::-webkit-details-marker]:hidden"
                aria-label={`Conta: ${userEmail}`}
              >
                {userEmail[0]?.toUpperCase() ?? '?'}
              </summary>
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex w-56 flex-col gap-1 rounded-[12px] border border-[var(--ct-line-2)] bg-[var(--ct-surface)] p-2 shadow-[var(--ct-shadow)]">
                <span className="truncate px-2 font-[family-name:var(--font-geist-mono)] text-[11.5px] text-[var(--ct-text-2)]">{userEmail}</span>
                {activeClient && <span className="px-2 text-[11px] text-[var(--ct-text-3)]">{ROLE_LABEL[role]}</span>}
                <button type="button" onClick={signOut} className="rounded-[8px] px-2 py-1.5 text-left text-[13px] text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]">
                  Sair
                </button>
              </div>
            </details>
          </span>
        </div>
        {previewing && (
          <div
            role="status"
            className="mx-3 mt-4 flex flex-none items-center gap-2.5 rounded-[14px] border border-[color-mix(in_srgb,var(--ct-accent)_30%,transparent)] bg-[var(--ct-accent-soft)] px-4 py-2.5 text-[13px] font-medium text-[var(--ct-accent)] lg:mx-8"
          >
            Você está vendo a Central como o cliente vê: sem configuração, sem ações de edição.
            <button type="button" onClick={() => setPreview(false)} className="ml-auto rounded-full px-2.5 py-0.5 text-[12px] underline-offset-2 hover:underline">
              Sair da visão do cliente
            </button>
          </div>
        )}
        <SectionTabs section={activeSection} />
        <main className="min-w-0 flex-1 overflow-auto">
          <NavHeadingContext.Provider value={heading}>{children}</NavHeadingContext.Provider>
        </main>
      </div>
    </div>
  )
}
