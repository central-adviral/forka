'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

interface Client {
  id: string
  name: string
  slug: string
  testsCount: number
  funnelsCount: number
}

// Same glyphs as the "Forka Redesign" mockup, inlined: four icons at one size don't justify
// pulling in an icon package.
const NAV_ICONS = {
  overview: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  tests: <path d="M4 12h6M14 12h6M10 6l4 6-4 6" strokeLinecap="round" strokeLinejoin="round" />,
  funnels: <path d="M4 4h16l-6 8v6l-4 2v-8L4 4z" strokeLinecap="round" strokeLinejoin="round" />,
  integrations: (
    <path d="M9 3v4M15 3v4M4 8h16M6 8v10a2 2 0 002 2h8a2 2 0 002-2V8" strokeLinecap="round" strokeLinejoin="round" />
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
  const activeClient = clients.find((client) => pathname.startsWith(`/dashboard/clients/${client.slug}`))

  return (
    <div className="flex h-screen bg-[#0B0E1A] text-[#E8EAF2]">
      <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-white/[0.08] bg-[#0B0E17] py-6">
        <div className="mb-6 flex items-center gap-2.5 px-5">
          <svg width="22" height="22" viewBox="0 0 26 26" fill="none">
            <path d="M6 4v9c0 3 2 5 5 5" stroke="#7C6FF0" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M11 18l-4 4M11 18l4 4" stroke="#7C6FF0" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="6" cy="4" r="2.4" fill="#7C6FF0" />
          </svg>
          <div>
            <div className="font-['Space_Grotesk'] text-[15px] font-semibold leading-none">Forka</div>
            <div className="mt-0.5 font-['JetBrains_Mono'] text-[9px] uppercase tracking-widest text-[#8A90A6]">
              Ad tracker
            </div>
          </div>
        </div>

        <div className="mb-2.5 px-5 font-['JetBrains_Mono'] text-[11px] uppercase tracking-widest text-[#8A90A6]">
          Clientes
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {clients.map((client) => {
            const active = pathname.startsWith(`/dashboard/clients/${client.slug}`)
            return (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.slug}`}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2.5 ${active ? 'bg-[#7C6FF0]/[0.14]' : ''}`}
              >
                <span
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-[7px] font-['Space_Grotesk'] text-xs font-bold ${
                    active ? 'bg-[#7C6FF0] text-[#0B0E1A]' : 'bg-[#1B2036] text-[#8A90A6]'
                  }`}
                >
                  {initials(client.name)}
                </span>
                <span className={`text-[13.5px] ${active ? 'font-semibold' : 'text-[#8A90A6]'}`}>{client.name}</span>
              </Link>
            )
          })}
        </nav>

        <div className="px-5 pt-2">
          <Link href="/dashboard/clients/new" className="text-[13px] font-medium text-[#7C6FF0] hover:text-[#9C90F5]">
            + Novo cliente
          </Link>
        </div>

        {activeClient && (
          <div className="mt-6">
            <div className="mb-2.5 truncate px-5 font-['JetBrains_Mono'] text-[11px] uppercase tracking-widest text-[#8A90A6]">
              {activeClient.name}
            </div>
            <nav className="flex flex-col gap-0.5 px-3">
              {[
                { href: `/dashboard/clients/${activeClient.slug}`, label: 'Visão geral', count: null, icon: NAV_ICONS.overview },
                {
                  href: `/dashboard/clients/${activeClient.slug}/tests`,
                  label: 'Funil de Teste',
                  count: activeClient.testsCount,
                  icon: NAV_ICONS.tests,
                },
                {
                  href: `/dashboard/clients/${activeClient.slug}/funis-venda`,
                  label: 'Funil de Venda',
                  count: activeClient.funnelsCount,
                  icon: NAV_ICONS.funnels,
                },
                {
                  href: `/dashboard/clients/${activeClient.slug}/integrations`,
                  label: 'Integrações',
                  count: null,
                  icon: NAV_ICONS.integrations,
                },
              ].map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                      active
                        ? 'bg-[#171B2C] font-semibold text-[#E8EAF2] shadow-[inset_2px_0_0_#7C6FF0]'
                        : 'text-[#8A90A6] hover:bg-[#171B2C]/60 hover:text-[#E8EAF2]'
                    }`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="flex-shrink-0 opacity-85"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </svg>
                    {item.label}
                    {item.count !== null && (
                      <span className="ml-auto font-['JetBrains_Mono'] text-[10.5px] text-[#565F7A]">{item.count}</span>
                    )}
                  </Link>
                )
              })}
            </nav>
          </div>
        )}

        <div className="mt-auto border-t border-white/[0.08] px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B2036] text-xs font-semibold text-[#8A90A6]">
              {userEmail[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">{userEmail}</span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}
