interface FunnelTotals {
  spend: number
  impressions: number
  reach: number
  linkClicks: number
  landingPageViews: number
  initiateCheckout: number
  /** Purchases the UTM ties to an ad: the ones this funnel's clicks and checkouts can explain. */
  vendas: number
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

export function FunnelCone({ totals, currency }: { totals: FunnelTotals; currency: (value: number) => string }) {
  const cpm = ratio(totals.spend, totals.impressions / 1000)
  const ctr = ratio(totals.linkClicks, totals.impressions)
  const cpc = ratio(totals.spend, totals.linkClicks)
  const connectRate = ratio(totals.landingPageViews, totals.linkClicks)
  const custoViewPage = ratio(totals.spend, totals.landingPageViews)
  const conversaoPaginaVendas = ratio(totals.initiateCheckout, totals.landingPageViews)
  const custoInitiateCheckout = ratio(totals.spend, totals.initiateCheckout)
  const conversaoCheckout = ratio(totals.vendas, totals.initiateCheckout)

  const stages: { label: string; value: number; color: string; badges: string[] }[] = [
    {
      label: 'Impressões',
      value: totals.impressions,
      color: 'var(--ct-accent)',
      badges: cpm !== null ? [`CPM ${currency(cpm)}`] : [],
    },
    { label: 'Alcance', value: totals.reach, color: 'var(--ct-accent)', badges: [] },
    {
      label: 'Cliques no link',
      value: totals.linkClicks,
      color: 'var(--ct-an)',
      badges: [ctr !== null ? `CTR ${(ctr * 100).toFixed(1)}%` : null, cpc !== null ? `CPC ${currency(cpc)}` : null].filter(
        (b): b is string => b !== null
      ),
    },
    {
      label: 'View page',
      value: totals.landingPageViews,
      color: 'var(--ct-an)',
      badges: [
        connectRate !== null ? `Connect rate ${(connectRate * 100).toFixed(1)}%` : null,
        custoViewPage !== null ? `Custo ${currency(custoViewPage)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Finalização de compra',
      value: totals.initiateCheckout,
      color: 'var(--ct-warn)',
      badges: [
        conversaoPaginaVendas !== null ? `Conv. página ${(conversaoPaginaVendas * 100).toFixed(1)}%` : null,
        custoInitiateCheckout !== null ? `Custo ${currency(custoInitiateCheckout)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Compras de anúncio',
      value: totals.vendas,
      color: 'var(--ct-ok)',
      badges: conversaoCheckout !== null ? [`Conv. checkout ${(conversaoCheckout * 100).toFixed(1)}%`] : [],
    },
  ]
  // Log scale: impressions run in millions and purchases in thousands, so a linear width would
  // squash every lower stage to the minimum and hide the drop between them.
  const maxLog = Math.log10(Math.max(10, totals.impressions))
  const widthOf = (value: number) => (value > 0 ? Math.max(42, 42 + 58 * (Math.log10(value) / maxLog)) : 42)
  const finalStage = stages[stages.length - 1]

  return (
    <div className="card-shadow h-full rounded-[22px] border border-[var(--ct-line)] p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="whitespace-nowrap text-base font-semibold">Caminho de conversão</h2>
        <span className="whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-wider text-[var(--ct-text-2)]">
          Gasto <span className="text-[var(--ct-text)]">{currency(totals.spend)}</span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        {stages.map((stage) => (
          <div
            key={stage.label}
            className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[10px] border border-[var(--ct-line)] px-3.5 py-2.5 text-[12.5px]"
            style={{
              width: `${widthOf(stage.value)}%`,
              background: `linear-gradient(90deg, color-mix(in srgb, ${stage.color} 16%, transparent), color-mix(in srgb, ${stage.color} 6%, transparent))`,
            }}
          >
            <span className="text-[var(--ct-text-2)]">{stage.label}</span>
            <b className="ml-auto font-[family-name:var(--font-geist-mono)] font-medium tabular-nums" style={{ color: stage.color }}>
              {stage.value.toLocaleString('pt-BR')}
            </b>
            {stage.badges.length > 0 && (
              <span className="basis-full font-[family-name:var(--font-geist-mono)] text-[10.5px] text-[var(--ct-text-3)]">{stage.badges.join(' · ')}</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-center font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-2)]">
        {finalStage.value.toLocaleString('pt-BR')} {finalStage.label.toLowerCase()} de {totals.impressions.toLocaleString('pt-BR')} impressões · conversão total{' '}
        <span className="text-[var(--ct-text)]">
          {totals.impressions > 0 ? `${((finalStage.value / totals.impressions) * 100).toFixed(3).replace('.', ',')}%` : '—'}
        </span>
      </p>
    </div>
  )
}
