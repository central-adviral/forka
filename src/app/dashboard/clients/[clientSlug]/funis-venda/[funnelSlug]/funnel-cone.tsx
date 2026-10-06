interface FunnelTotals {
  spend: number
  impressions: number
  reach: number
  linkClicks: number
  landingPageViews: number
  initiateCheckout: number
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
      label: 'Cliques no Link',
      value: totals.linkClicks,
      color: 'var(--ct-an)',
      badges: [ctr !== null ? `CTR ${(ctr * 100).toFixed(1)}%` : null, cpc !== null ? `CPC ${currency(cpc)}` : null].filter(
        (b): b is string => b !== null
      ),
    },
    {
      label: 'View Page',
      value: totals.landingPageViews,
      color: 'var(--ct-an)',
      badges: [
        connectRate !== null ? `Connect Rate ${(connectRate * 100).toFixed(1)}%` : null,
        custoViewPage !== null ? `Custo ${currency(custoViewPage)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Finalização de Compra',
      value: totals.initiateCheckout,
      color: 'var(--ct-warn)',
      badges: [
        conversaoPaginaVendas !== null ? `Conv. Pág. Vendas ${(conversaoPaginaVendas * 100).toFixed(1)}%` : null,
        custoInitiateCheckout !== null ? `Custo ${currency(custoInitiateCheckout)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Compras',
      value: totals.vendas,
      color: 'var(--ct-ok)',
      badges: conversaoCheckout !== null ? [`Conv. Checkout ${(conversaoCheckout * 100).toFixed(1)}%`] : [],
    },
  ]
  const maxValue = Math.max(1, totals.impressions)

  return (
    <div className="card-shadow h-full rounded-2xl border border-[var(--ct-line)] p-5">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="whitespace-nowrap font-[family-name:var(--font-sora)] text-base font-semibold">Funil de tráfego</h2>
        <span className="whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-wider text-[var(--ct-text-2)]">
          Gasto <span className="text-[var(--ct-text)]">{currency(totals.spend)}</span>
        </span>
      </div>
      <div className="relative mx-auto max-w-[460px]">
        {/* Spine down the middle: the stages read as one funnel narrowing rather than as five
            disconnected bars. */}
        <div
          className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2"
          style={{ background: 'linear-gradient(180deg, rgba(124,111,240,.35), rgba(45,212,168,.35))' }}
        />
        {stages.map((stage, index) => {
          // Each stage tapers from its own share of the total down to the next stage's, so the
          // drop between steps shows up as geometry, not only as a number.
          const widthOf = (value: number) => Math.max(22, (value / maxValue) * 100)
          const top = widthOf(stage.value)
          const bottom = widthOf(stages[index + 1]?.value ?? stage.value * 0.82)
          return (
            <div key={stage.label} className={`relative ${index > 0 ? 'mt-4' : ''}`}>
              {stage.badges.length > 0 && (
                <div className="mb-1.5 flex justify-center gap-3 font-[family-name:var(--font-geist-mono)] text-[10.5px] text-[var(--ct-text-2)]">
                  {stage.badges.map((badge) => (
                    <span key={badge}>{badge}</span>
                  ))}
                </div>
              )}
              <div className="relative h-[74px]">
                <div
                  className="absolute inset-0"
                  style={{
                    clipPath: `polygon(calc(50% - ${top / 2}%) 0, calc(50% + ${top / 2}%) 0, calc(50% + ${bottom / 2}%) 100%, calc(50% - ${bottom / 2}%) 100%)`,
                    backgroundColor: `${stage.color}1A`,
                    borderTop: `1px solid ${stage.color}66`,
                    borderBottom: `1px solid ${stage.color}33`,
                  }}
                />
                <div className="relative flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ct-text-2)]">{stage.label}</div>
                  <div className="font-[family-name:var(--font-geist-mono)] text-[17px] font-bold leading-none" style={{ color: stage.color }}>
                    {stage.value.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-center font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-2)]">
        {stages[stages.length - 1].value.toLocaleString('pt-BR')} compras de{' '}
        {totals.impressions.toLocaleString('pt-BR')} impressões · conversão total{' '}
        <span className="text-[var(--ct-text)]">
          {totals.impressions > 0
            ? `${((stages[stages.length - 1].value / totals.impressions) * 100).toFixed(3)}%`
            : '—'}
        </span>
      </p>
    </div>
  )
}
