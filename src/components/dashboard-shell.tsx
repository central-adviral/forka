'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'
import type { ClientRole } from '@/lib/repo/client-access-repo'

export interface ShellProject {
  name: string
  slug: string
  isActive: boolean
}

interface Client {
  id: string
  name: string
  slug: string
  testsCount: number
  projects: ShellProject[]
  role: ClientRole
}

const ROLE_LABEL: Record<ClientRole, string> = {
  owner: 'Owner',
  gestor: 'Gestor',
  analista: 'Analista',
  cliente: 'Cliente · leitura',
}

// Inlined glyphs: a handful of icons at one size don't justify pulling in an icon package.
const ICONS = {
  overview: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  integrations: <path d="M6 4.5 4.5 3a2.1 2.1 0 0 0-3 3L3 7.5M10 11.5l1.5 1.5a2.1 2.1 0 0 0 3-3L13 8.5M5.5 10.5l5-5" />,
  portfolio: (
    <>
      <rect x="2" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="9" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="2" y="9.5" width="5" height="4" rx="1.2" />
      <rect x="9" y="9.5" width="5" height="4" rx="1.2" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  rules: <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />,
  members: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c.6-2.4 2.3-3.5 4.5-3.5s3.9 1.1 4.5 3.5M11 3.2a2.4 2.4 0 0 1 0 4.6M12.5 10.3c1 .5 1.7 1.6 2 3.2" />
    </>
  ),
} as const

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

// Breadcrumb label for the page, read off the last meaningful URL segment.
function pageLabel(pathname: string, clientSlug: string | undefined): string {
  if (pathname === '/dashboard') return 'Carteira'
  if (pathname === '/dashboard/clients/new') return 'Novo cliente'
  if (!clientSlug) return ''
  const rest = pathname.slice(`/dashboard/clients/${clientSlug}`.length).split('/').filter(Boolean)
  if (rest.length === 0) return 'Hoje'
  const last = rest[rest.length - 1]
  if (last === 'new') return rest[0] === 'tests' ? 'Novo teste' : 'Novo projeto'
  if (last === 'edit') return 'Editar'
  if (last === 'link') return 'Link e rastreio'
  if (last === 'regras') return 'Regras de campanha'
  if (rest[0] === 'integrations') return 'Integrações'
  if (rest[0] === 'membros') return 'Membros'
  if (rest[0] === 'tests') return rest.length === 1 ? 'Teste A/B' : 'Relatório'
  if (rest[0] === 'funis-venda') return 'Análises'
  return ''
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[15px] w-[15px] flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function NavLink({
  href,
  active,
  children,
  count,
}: {
  href: string
  active: boolean
  children: React.ReactNode
  count?: number
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-[13.5px] font-medium transition-colors ${
        active
          ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]'
          : 'text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]'
      }`}
    >
      {children}
      {count !== undefined && (
        <span className="ml-auto rounded-full bg-[var(--ct-surface-3)] px-[7px] py-px font-[family-name:var(--font-geist-mono)] text-[10.5px] text-[var(--ct-text-3)]">
          {count}
        </span>
      )}
    </Link>
  )
}

// Dark by default; the choice lives in localStorage and is applied before paint by the root layout.
function ThemeToggle() {
  function toggle() {
    const root = document.documentElement
    const next = root.dataset.mode === 'light' ? 'dark' : 'light'
    if (next === 'light') root.dataset.mode = 'light'
    else delete root.dataset.mode
    try {
      localStorage.setItem('ct-mode', next)
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Alternar tema claro e escuro"
      className="flex w-full items-center gap-2.5 rounded-[10px] bg-[var(--ct-surface-2)] px-2.5 py-2 text-[12.5px] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
    >
      <Icon>
        <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
      </Icon>
      Tema claro / escuro
    </button>
  )
}

function Dot({ color }: { color: string }) {
  return <span className="mx-[4.5px] h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} />
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2.5 pb-[5px] pt-2.5 font-[family-name:var(--font-geist-mono)] text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ct-text-3)]">
      {children}
    </span>
  )
}

function Picker({
  label,
  value,
  badge,
  badgeTone,
  children,
}: {
  label: string
  value: string
  badge: string
  badgeTone?: 'an'
  children: React.ReactNode
}) {
  return (
    <details className="group relative">
      <summary className="flex w-full cursor-pointer list-none items-center gap-2.5 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2.5 py-2 text-left hover:border-[var(--ct-line-2)] [&::-webkit-details-marker]:hidden">
        <span
          className={`grid h-6 w-6 flex-none place-items-center rounded-[7px] font-[family-name:var(--font-geist-mono)] text-[10.5px] font-medium ${
            badgeTone === 'an' ? 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]' : 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]'
          }`}
        >
          {badge}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <small className="font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]">
            {label}
          </small>
          <b className="truncate text-[13px] font-semibold">{value}</b>
        </span>
        <span className="ml-auto text-[11px] text-[var(--ct-text-3)]" aria-hidden="true">
          ⇅
        </span>
      </summary>
      <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 flex max-h-72 flex-col gap-px overflow-y-auto rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
        {children}
      </div>
    </details>
  )
}

function PickerItem({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 truncate rounded-[7px] px-2.5 py-1.5 text-[13px] ${
        active ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-3)] hover:text-[var(--ct-text)]'
      }`}
    >
      {children}
    </Link>
  )
}

export function DashboardShell({
  clients,
  userEmail,
  children,
}: {
  clients: Client[]
  userEmail: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  async function signOut() {
    await createBrowserSupabaseClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }
  const activeClient = clients.find(
    (client) => pathname === `/dashboard/clients/${client.slug}` || pathname.startsWith(`/dashboard/clients/${client.slug}/`)
  )
  const base = activeClient ? `/dashboard/clients/${activeClient.slug}` : ''
  // The open test and project, read off the URL rather than passed down: the shell renders above
  // the page that knows which one it is, so a prop would have to be threaded through every route.
  const activeTestSlug = activeClient ? pathname.match(new RegExp(`^${base}/tests/([^/]+)`))?.[1] : undefined
  const activeProjectSlug = activeClient ? pathname.match(new RegExp(`^${base}/funis-venda/([^/]+)`))?.[1] : undefined
  const activeProject = activeClient?.projects.find((project) => project.slug === activeProjectSlug)
  const canConfigure = activeClient?.role === 'owner'
  const canEdit = activeClient?.role === 'owner' || activeClient?.role === 'gestor'
  // Rules belong to a project: the open one, or the first one of the client.
  const rulesProject = activeProject ?? activeClient?.projects[0]
  const page = pageLabel(pathname, activeClient?.slug)

  return (
    <div className="flex h-screen font-[family-name:var(--font-manrope)] text-[var(--ct-text)]">
      <aside className="m-3.5 mr-0 flex w-[264px] flex-none flex-col gap-[18px] overflow-y-auto rounded-[22px] border border-[var(--ct-line)] bg-[var(--ct-glass)] px-3 py-[18px] shadow-[var(--ct-shadow)] backdrop-blur-xl">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2 py-0.5">
          <span
            className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
            style={{ background: 'linear-gradient(145deg, var(--ct-an), var(--ct-painel) 55%, var(--ct-ab))' }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4">
              <path d="M2 12 L6 7 L9 9.5 L14 3" stroke="#0A0C11" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            <b className="block font-[family-name:var(--font-sora)] text-sm font-semibold tracking-[-0.02em]">Central de Tráfego</b>
            <span className="block font-[family-name:var(--font-geist-mono)] text-[10.5px] text-[var(--ct-text-3)]">
              black sheep · v0.1
            </span>
          </span>
        </Link>

        <div className="flex flex-col gap-1.5" key={pathname}>
          <Picker
            label="Cliente"
            value={activeClient?.name ?? 'Escolher cliente'}
            badge={activeClient ? initials(activeClient.name) : '··'}
          >
            {clients.map((client) => (
              <PickerItem key={client.id} href={`/dashboard/clients/${client.slug}`} active={client.id === activeClient?.id}>
                {client.name}
              </PickerItem>
            ))}
            {clients.length === 0 && <span className="px-2.5 py-1.5 text-[12.5px] text-[var(--ct-text-3)]">Nenhum cliente ainda</span>}
          </Picker>
          {activeClient && (
            <Picker
              label="Projeto"
              value={activeProject?.name ?? 'Todos os projetos'}
              badge={activeProject ? initials(activeProject.name) : '∗'}
              badgeTone="an"
            >
              <PickerItem href={`${base}/funis-venda`} active={!activeProject}>
                Todos os projetos
              </PickerItem>
              {activeClient.projects.map((project) => (
                <PickerItem key={project.slug} href={`${base}/funis-venda/${project.slug}`} active={project.slug === activeProjectSlug}>
                  <span className="truncate">{project.name}</span>
                  {!project.isActive && <span className="ml-auto text-[11px] text-[var(--ct-text-3)]">pausado</span>}
                </PickerItem>
              ))}
            </Picker>
          )}
        </div>

        <nav className="flex flex-col gap-px" aria-label="Navegação">
          {activeClient && (
            <>
              <NavLink href={base} active={pathname === base}>
                <Icon>{ICONS.overview}</Icon>
                Hoje
              </NavLink>

              <GroupLabel>Ferramentas</GroupLabel>
              <span
                className="flex cursor-default items-center gap-2.5 whitespace-nowrap rounded-[7px] px-2.5 py-[7px] text-[13.5px] font-medium text-[var(--ct-text-3)]"
                title="Vigias, alertas e relatórios — Fase 3 do roadmap"
              >
                <Dot color="var(--ct-painel)" />
                Painel de Controle
                <span className="ml-auto rounded-full border border-dashed border-[var(--ct-line-2)] px-1.5 font-[family-name:var(--font-geist-mono)] text-[9.5px]">breve</span>
              </span>
              <NavLink href={`${base}/funis-venda`} active={pathname.startsWith(`${base}/funis-venda`)} count={activeClient.projects.length}>
                <Dot color="var(--ct-an)" />
                Análises
              </NavLink>
              <NavLink href={`${base}/tests`} active={pathname === `${base}/tests` || pathname === `${base}/tests/new`} count={activeClient.testsCount}>
                <Dot color="var(--ct-ab)" />
                Teste A/B
              </NavLink>
              {activeTestSlug && activeTestSlug !== 'new' && (
                <div className="ml-[19px] flex flex-col gap-px border-l border-[var(--ct-line)] pl-3">
                  {[
                    { href: `${base}/tests/${activeTestSlug}`, label: 'Relatório' },
                    { href: `${base}/tests/${activeTestSlug}/link`, label: 'Link e rastreio' },
                  ].map((sub) => (
                    <NavLink key={sub.href} href={sub.href} active={pathname === sub.href}>
                      <span className="text-[12.5px]">{sub.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}

              {(canConfigure || canEdit) && <GroupLabel>Configurar</GroupLabel>}
              {canConfigure && (
                <NavLink href={`${base}/integrations`} active={pathname.startsWith(`${base}/integrations`)}>
                  <Icon>{ICONS.integrations}</Icon>
                  Integrações
                </NavLink>
              )}
              {canEdit && rulesProject && (
                <NavLink
                  href={`${base}/funis-venda/${rulesProject.slug}/regras`}
                  active={pathname.endsWith('/regras')}
                >
                  <Icon>{ICONS.rules}</Icon>
                  Regras de campanha
                </NavLink>
              )}
              {canConfigure && (
                <NavLink href={`${base}/membros`} active={pathname.startsWith(`${base}/membros`)}>
                  <Icon>{ICONS.members}</Icon>
                  Membros
                </NavLink>
              )}
            </>
          )}

          <GroupLabel>Agência</GroupLabel>
          <NavLink href="/dashboard" active={pathname === '/dashboard'} count={clients.length}>
            <Icon>{ICONS.portfolio}</Icon>
            Carteira
          </NavLink>
          <NavLink href="/dashboard/clients/new" active={pathname === '/dashboard/clients/new'}>
            <Icon>{ICONS.plus}</Icon>
            Novo cliente
          </NavLink>
        </nav>

        <div className="mt-auto flex flex-col gap-2">
        <ThemeToggle />
        <div className="flex items-center gap-2.5 rounded-[10px] bg-[var(--ct-surface-2)] px-2.5 py-2">
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--ct-surface-3)] text-xs font-semibold text-[var(--ct-text-2)]">
            {userEmail[0]?.toUpperCase() ?? '?'}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-[family-name:var(--font-geist-mono)] text-[11.5px] text-[var(--ct-text-2)]">{userEmail}</span>
            {activeClient && <span className="text-[11px] text-[var(--ct-text-3)]">{ROLE_LABEL[activeClient.role]}</span>}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="ml-auto flex-none rounded-md px-1.5 py-0.5 text-[11.5px] text-[var(--ct-text-3)] hover:bg-[var(--ct-surface-3)] hover:text-[var(--ct-text)]"
          >
            Sair
          </button>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-8 mt-3.5 flex flex-none items-center gap-3 rounded-full border border-[var(--ct-line)] bg-[var(--ct-glass)] px-6 py-3 shadow-[var(--ct-shadow)] backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px] text-[var(--ct-text-3)]">
            <span>Black Sheep</span>
            {activeClient && (
              <>
                <i className="not-italic opacity-50">/</i>
                <span>{activeClient.name}</span>
              </>
            )}
            {activeProject && (
              <>
                <i className="not-italic opacity-50">/</i>
                <span>{activeProject.name}</span>
              </>
            )}
            {page && (
              <>
                <i className="not-italic opacity-50">/</i>
                <b className="font-medium text-[var(--ct-text)]">{page}</b>
              </>
            )}
          </div>
          {activeClient && activeClient.role !== 'owner' && activeClient.role !== 'gestor' && (
            <span className="ml-auto rounded-full bg-[var(--ct-accent-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--ct-accent)]">
              Somente leitura
            </span>
          )}
        </div>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
