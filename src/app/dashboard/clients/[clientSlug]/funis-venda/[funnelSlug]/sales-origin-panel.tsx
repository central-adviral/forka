import type { SalesByOrigin } from '@/lib/repo/funnel-repo'

// The same order everywhere: what the ads brought first, then what came in on its own.
const ORIGINS: { key: string; label: string; rule: string; fromAd: boolean }[] = [
  { key: 'anuncio', label: 'Anúncio Meta', rule: 'ad_id do Meta na utm_content', fromAd: true },
  { key: 'anuncio_legado', label: 'Anúncio · UTM antiga', rule: 'utm_source=facebookads, sem ad_id', fromAd: true },
  { key: 'organico_bio', label: 'Bio do Instagram', rule: 'ig/instagram com "bio" na UTM', fromAd: false },
  { key: 'sem_utm', label: 'Sem UTM', rule: 'nenhuma UTM na venda', fromAd: false },
  { key: 'outro', label: 'Outros', rule: 'qualquer outra UTM', fromAd: false },
]

export function SalesOriginPanel({ origins, currency }: { origins: SalesByOrigin[]; currency: (value: number) => string }) {
  const byKey = new Map(origins.map((origin) => [origin.origem, origin]))
  const total = origins.reduce((sum, origin) => sum + origin.vendas, 0)
  if (total === 0) return null
  const fromAd = ORIGINS.filter((origin) => origin.fromAd).reduce((sum, origin) => sum + (byKey.get(origin.key)?.vendas ?? 0), 0)

  return (
    <div className="card-shadow mb-6 rounded-2xl border border-[var(--ct-line)] p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Origem das vendas de entrada</h2>
        <span className="text-[12px] text-[var(--ct-text-2)]">
          {fromAd.toLocaleString('pt-BR')} de anúncio · {(total - fromAd).toLocaleString('pt-BR')} de outras origens
        </span>
      </div>
      <p className="mb-4 text-[12px] text-[var(--ct-text-2)]">
        O CPA geral divide o investimento por todas estas vendas. O CPA de anúncio, os criativos e os testes contam só as
        linhas marcadas como anúncio.
      </p>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--ct-surface-2)]" role="img" aria-label="Fatia de cada origem nas vendas de entrada">
        {ORIGINS.map((origin) => {
          const vendas = byKey.get(origin.key)?.vendas ?? 0
          if (vendas === 0) return null
          return (
            <div
              key={origin.key}
              title={`${origin.label}: ${vendas}`}
              style={{ width: `${(vendas / total) * 100}%`, background: origin.fromAd ? 'var(--ct-accent)' : 'var(--ct-text-3)' }}
            />
          )
        })}
      </div>
      <table className="mt-4 w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ct-text-2)]">
            <th className="py-1.5 font-medium">Origem</th>
            <th className="py-1.5 font-medium">Regra</th>
            <th className="py-1.5 text-right font-medium">Vendas</th>
            <th className="py-1.5 text-right font-medium">Fatia</th>
            <th className="py-1.5 text-right font-medium">Upsell</th>
            <th className="py-1.5 text-right font-medium">Receita líquida</th>
          </tr>
        </thead>
        <tbody>
          {ORIGINS.map((origin) => {
            const row = byKey.get(origin.key)
            if (!row || (row.vendas === 0 && row.vendasUpsell === 0)) return null
            return (
              <tr key={origin.key} className="border-t border-[var(--ct-line)]">
                <td className="py-2">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: origin.fromAd ? 'var(--ct-accent)' : 'var(--ct-text-3)' }} />
                  {origin.label}
                </td>
                <td className="py-2 text-[12px] text-[var(--ct-text-2)]">{origin.rule}</td>
                <td className="py-2 text-right font-[family-name:var(--font-geist-mono)] tabular-nums">{row.vendas.toLocaleString('pt-BR')}</td>
                <td className="py-2 text-right font-[family-name:var(--font-geist-mono)] tabular-nums text-[var(--ct-text-2)]">
                  {((row.vendas / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </td>
                <td className="py-2 text-right font-[family-name:var(--font-geist-mono)] tabular-nums">{row.vendasUpsell.toLocaleString('pt-BR')}</td>
                <td className="py-2 text-right font-[family-name:var(--font-geist-mono)] tabular-nums">{currency(row.receitaLiquida)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
