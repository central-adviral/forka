'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

interface Client {
  id: string
  name: string
  slug: string
}

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

  return (
    <div className="flex h-screen bg-[#0B0E1A] text-[#E8EAF2]">
      <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-white/[0.08] bg-[#141829] py-6">
        <div className="mb-6 flex items-center gap-2.5 px-5">
          <span className="font-['Space_Grotesk'] text-[15px] font-semibold">Testes A/B</span>
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
