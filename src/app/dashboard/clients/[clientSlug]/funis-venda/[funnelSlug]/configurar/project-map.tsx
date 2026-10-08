import type { ProjectQualityRow } from '@/lib/domain/project-quality'

// "Mapa do projeto": campaigns → fronts → project → products → sales, with the last 30 days in
// each box and a red box where something is empty, so the why of every number is one picture.

export interface MapFront {
  name: string
  code: string
  mirrorOf: string | null
  spend: number
}

export interface MapProduct {
  name: string
  role: string
  sales: number
}

const ROLE_LABEL: Record<string, string> = { entrada: 'entrada', order_bump: 'order bump', upsell: 'upsell', ascensao: 'ascensão' }
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function Box({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-2 rounded-[14px] border px-4 py-3.5 ${
        empty ? 'border-[var(--ct-crit)]/50 bg-[var(--ct-crit-soft)]' : 'border-[var(--ct-line)] bg-[var(--ct-surface)]'
      }`}
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">{title}</h3>
      {empty ? <p className="text-[12.5px] text-[var(--ct-crit)]">{empty}</p> : children}
    </section>
  )
}

const Arrow = () => (
  <span aria-hidden="true" className="hidden self-center text-[var(--ct-text-3)] lg:block">
    →
  </span>
)

export function ProjectMap({ fronts, products, quality, resultado }: { fronts: MapFront[]; products: MapProduct[]; quality: ProjectQualityRow | null; resultado: string }) {
  const spend = fronts.reduce((total, front) => total + front.spend, 0)
  const entries = Number(quality?.vendas_entrada ?? 0)
  const fromAds = Number(quality?.vendas_anuncio ?? 0)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[16px] font-semibold">Mapa do projeto</h2>
        <p className="mt-1 text-[13px] text-[var(--ct-text-2)]">Últimos 30 dias. Cada caixa alimenta a seguinte; vermelho é onde falta algo.</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.8fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Box title="Campanhas → frentes" empty={fronts.length === 0 ? 'Nenhuma frente: nenhuma campanha é do projeto.' : null}>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {fronts.map((front) => (
              <li key={front.code} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {front.name}
                  {front.mirrorOf && <span className="ml-1.5 text-[11.5px] text-[var(--ct-text-3)]">lê {front.mirrorOf}</span>}
                </span>
                <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">{brl(front.spend)}</span>
              </li>
            ))}
          </ul>
          {quality && Number(quality.cliente_gasto_sem_frente) > 0 && (
            <p className="text-[12px] text-[var(--ct-warn)]">{brl(Number(quality.cliente_gasto_sem_frente))} do cliente sem frente, fora de todo projeto</p>
          )}
        </Box>
        <Arrow />
        <Box title="Projeto" empty={null}>
          <p className="font-[family-name:var(--font-geist-mono)] text-[20px] font-semibold tabular-nums">{brl(spend)}</p>
          <p className="text-[12.5px] text-[var(--ct-text-2)]">
            {resultado === 'lead'
              ? 'investimento das frentes ÷ leads = CPL'
              : `investimento ÷ ${entries.toLocaleString('pt-BR')} vendas de entrada = ${entries > 0 ? brl(spend / entries) : '—'} de CPA geral`}
          </p>
        </Box>
        <Arrow />
        <Box
          title="Produtos e papel"
          empty={resultado !== 'lead' && !products.some((product) => product.role === 'entrada') ? 'Nenhum produto de entrada: o CPA não tem venda para contar.' : null}
        >
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {products.map((product) => (
              <li key={product.name} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {product.name} <span className="text-[11.5px] text-[var(--ct-text-3)]">{ROLE_LABEL[product.role] ?? product.role}</span>
                </span>
                <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">{product.sales.toLocaleString('pt-BR')}</span>
              </li>
            ))}
          </ul>
        </Box>
        <Arrow />
        <Box title="De onde veio o comprador" empty={quality && entries === 0 && resultado !== 'lead' ? 'Nenhuma venda de entrada no período.' : null}>
          {quality && (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              <li className="flex justify-between gap-3">
                <span>de anúncio</span>
                <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">{fromAds.toLocaleString('pt-BR')}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>outra origem</span>
                <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">{(entries - fromAds).toLocaleString('pt-BR')}</span>
              </li>
              {Number(quality.cliente_vendas_sem_projeto) > 0 && (
                <li className="flex justify-between gap-3 text-[var(--ct-warn)]">
                  <span>do cliente, sem projeto</span>
                  <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">{Number(quality.cliente_vendas_sem_projeto).toLocaleString('pt-BR')}</span>
                </li>
              )}
            </ul>
          )}
        </Box>
      </div>
    </div>
  )
}
