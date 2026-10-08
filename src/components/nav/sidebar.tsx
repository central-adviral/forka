'use client'

import Link from 'next/link'
import type { NavGroup, SetupView } from '@/lib/nav/nav-config'
import { NavSectionItem } from './nav-section'
import { SetupNotice } from './setup-progress'

export interface SidebarProject {
  name: string
  slug: string
  isActive: boolean
}

interface Props {
  clients: { id: string; name: string; slug: string }[]
  activeClient: { id: string; name: string; slug: string; projects: SidebarProject[] } | null
  project: SidebarProject | null
  /** Where a project picked in the selector opens: the same subsection for that project when there is one. */
  projectHref: (slug: string) => string
  groups: NavGroup[]
  setup: SetupView | undefined
  setupHref: string | null
  collapsed: boolean
  onToggleCollapse?: () => void
  canPreview: boolean
  previewing: boolean
  onTogglePreview: () => void
  /** Closes the mobile drawer after a link is followed. */
  onNavigate?: () => void
  pathname: string
}

const mono = 'font-[family-name:var(--font-geist-mono)]'

function Picker({ label, value, dot, children }: { label: string; value: string; dot?: string; children: React.ReactNode }) {
  return (
    <details className="group relative min-w-0">
      <summary className="flex min-h-[50px] cursor-pointer list-none flex-col items-start justify-center rounded-[12px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 hover:border-[var(--ct-text-3)] [&::-webkit-details-marker]:hidden">
        <small className={`${mono} text-[10px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>{label} ▾</small>
        <b className="flex max-w-full items-center gap-1.5 truncate text-[13px] font-semibold">
          {dot && <span className={`h-[7px] w-[7px] flex-none rounded-full ${dot}`} aria-hidden="true" />}
          <span className="truncate">{value}</span>
        </b>
      </summary>
      <div className="absolute left-0 top-[calc(100%+4px)] z-30 flex max-h-72 w-[240px] flex-col gap-px overflow-y-auto rounded-[12px] border border-[var(--ct-line-2)] bg-[var(--ct-surface)] p-1 shadow-[var(--ct-shadow)]">
        {children}
      </div>
    </details>
  )
}

function PickerItem({ href, active, onNavigate, children }: { href: string; active: boolean; onNavigate?: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 truncate rounded-[8px] px-2.5 py-1.5 text-[13px] ${
        active ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]'
      }`}
    >
      {children}
    </Link>
  )
}

export function Sidebar(props: Props) {
  const { collapsed, activeClient, project, groups } = props
  const projectDot = props.setup ? (props.setup.done === props.setup.total ? 'bg-[var(--ct-ok)]' : 'bg-[var(--ct-warn)]') : undefined

  return (
    <div className={`flex h-full flex-col gap-4 ${collapsed ? 'items-stretch px-2' : 'px-3.5'} py-[18px]`}>
      <div className={`flex items-center gap-2.5 px-1 ${collapsed ? 'flex-col' : ''}`}>
        <Link href="/dashboard" onClick={props.onNavigate} className="flex min-w-0 items-center gap-2.5" aria-label="Central de Tráfego, ir para a Carteira">
          <span
            className="grid h-8 w-8 flex-none place-items-center rounded-[10px] font-[family-name:var(--font-sora)] text-[13px] font-semibold text-[var(--ct-on-accent)]"
            style={{ background: 'linear-gradient(145deg, var(--ct-an), var(--ct-painel) 55%, var(--ct-ab))' }}
            aria-hidden="true"
          >
            CT
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col leading-tight">
              <b className="truncate font-[family-name:var(--font-sora)] text-[14px] font-semibold tracking-[-0.02em]">Central de Tráfego</b>
              <span className={`${mono} text-[11px] text-[var(--ct-text-3)]`}>black sheep</span>
            </span>
          )}
        </Link>
        {props.onToggleCollapse && (
          <button
            type="button"
            onClick={props.onToggleCollapse}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!collapsed}
            className={`${collapsed ? '' : 'ml-auto'} grid h-9 w-9 flex-none place-items-center rounded-[9px] text-[var(--ct-text-3)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]`}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
            </svg>
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 gap-1.5" key={props.pathname}>
            <Picker label="Cliente" value={activeClient?.name ?? 'Escolher'}>
              {props.clients.map((client) => (
                <PickerItem key={client.id} href={`/dashboard/clients/${client.slug}`} active={client.id === activeClient?.id} onNavigate={props.onNavigate}>
                  {client.name}
                </PickerItem>
              ))}
              {props.clients.length === 0 && <span className="px-2.5 py-1.5 text-[12.5px] text-[var(--ct-text-3)]">Nenhum cliente ainda</span>}
            </Picker>
            {activeClient ? (
              <Picker label="Projeto" value={project?.name ?? 'Nenhum'} dot={projectDot}>
                {activeClient.projects.map((item) => (
                  <PickerItem key={item.slug} href={props.projectHref(item.slug)} active={item.slug === project?.slug} onNavigate={props.onNavigate}>
                    <span className="truncate">{item.name}</span>
                    {!item.isActive && <span className="ml-auto text-[11px] text-[var(--ct-text-3)]">pausado</span>}
                  </PickerItem>
                ))}
                <PickerItem href={`/dashboard/clients/${activeClient.slug}/funis-venda`} active={false} onNavigate={props.onNavigate}>
                  <span className="text-[var(--ct-text-3)]">Todos os projetos</span>
                </PickerItem>
              </Picker>
            ) : (
              <span />
            )}
          </div>
          <SetupNotice setup={props.setup} href={props.setupHref} onNavigate={props.onNavigate} />
        </>
      )}

      <nav aria-label="Seções" className="flex flex-col gap-2 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {!collapsed && (
              <span className={`${mono} px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>{group.label}</span>
            )}
            {group.sections.map((section) => (
              <NavSectionItem key={section.id} section={section} collapsed={collapsed} onNavigate={props.onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      <div className={`mt-auto flex items-center gap-1.5 border-t border-[var(--ct-line)] pt-3 ${collapsed ? 'flex-col' : ''}`}>
        <Link
          href="/dashboard"
          onClick={props.onNavigate}
          aria-current={props.pathname === '/dashboard' ? 'page' : undefined}
          aria-label={`Carteira, ${props.clients.length} ${props.clients.length === 1 ? 'cliente' : 'clientes'}`}
          className={`flex min-h-[42px] flex-1 items-center gap-2.5 rounded-[11px] px-3 py-2 text-[14px] font-medium ${
            collapsed ? 'w-full flex-col justify-center gap-1 px-0.5' : ''
          } ${props.pathname === '/dashboard' ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]'}`}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
          </svg>
          {collapsed ? (
            <span className="text-[10.5px] font-semibold">Carteira</span>
          ) : (
            <>
              <span className="flex-1">Carteira</span>
              <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-px text-[11px] text-[var(--ct-text-2)]`} aria-hidden="true">
                {props.clients.length}
              </span>
            </>
          )}
        </Link>
        {props.canPreview && (
          <button
            type="button"
            onClick={props.onTogglePreview}
            aria-pressed={props.previewing}
            aria-label="Ver como cliente"
            title="Ver como cliente"
            className={`grid h-[42px] w-[42px] flex-none place-items-center rounded-[10px] ${
              props.previewing ? 'bg-[var(--ct-accent)] text-[var(--ct-on-accent)]' : 'bg-[var(--ct-surface-2)] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
