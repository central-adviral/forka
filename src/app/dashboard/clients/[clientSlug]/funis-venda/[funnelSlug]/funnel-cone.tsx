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
      color: '#7C6FF0',
      badges: cpm !== null ? [`CPM ${currency(cpm)}`] : [],
    },
    { label: 'Alcance', value: totals.reach, color: '#9B8CFB', badges: [] },
    {
      label: 'Cliques no Link',
      value: totals.linkClicks,
      color: '#4F8EF7',
      badges: [ctr !== null ? `CTR ${(ctr * 100).toFixed(1)}%` : null, cpc !== null ? `CPC ${currency(cpc)}` : null].filter(
        (b): b is string => b !== null
      ),
    },
    {
      label: 'View Page',
      value: totals.landingPageViews,
      color: '#3FB8E8',
      badges: [
        connectRate !== null ? `Connect Rate ${(connectRate * 100).toFixed(1)}%` : null,
        custoViewPage !== null ? `Custo ${currency(custoViewPage)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Finalização de Compra',
      value: totals.initiateCheckout,
      color: '#F5B94D',
      badges: [
        conversaoPaginaVendas !== null ? `Conv. Pág. Vendas ${(conversaoPaginaVendas * 100).toFixed(1)}%` : null,
        custoInitiateCheckout !== null ? `Custo ${currency(custoInitiateCheckout)}` : null,
      ].filter((b): b is string => b !== null),
    },
    {
      label: 'Compras',
      value: totals.vendas,
      color: '#2DD4A8',
      badges: conversaoCheckout !== null ? [`Conv. Checkout ${(conversaoCheckout * 100).toFixed(1)}%`] : [],
    },
  ]
  const maxValue = Math.max(1, totals.impressions)

  return (
    <div className="card-shadow mb-6 rounded-2xl border border-white/[0.08] p-5">
      <h2 className="mb-1 font-['Space_Grotesk'] text-base font-semibold">Funil de Tráfego</h2>
      <p className="mb-5 text-[13px] text-[#8A90A6]">
        Valor gasto no período: <span className="font-['JetBrains_Mono'] text-[#E8EAF2]">{currency(totals.spend)}</span>
      </p>
      <div className="flex flex-col items-center gap-2">
        {stages.map((stage) => {
          const widthPct = Math.max(14, (stage.value / maxValue) * 100)
          return (
            <div key={stage.label} className="flex w-full flex-col items-center">
              {stage.badges.length > 0 && (
                <div className="mb-1.5 flex gap-2 font-['JetBrains_Mono'] text-[11px] text-[#8A90A6]">
                  {stage.badges.map((badge) => (
                    <span key={badge}>{badge}</span>
                  ))}
                </div>
              )}
              <div
                className="flex items-center justify-center rounded-[10px] py-3.5 text-center transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: `${stage.color}1A`, border: `1px solid ${stage.color}55` }}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">{stage.label}</div>
                  <div className="font-['JetBrains_Mono'] text-lg font-semibold" style={{ color: stage.color }}>
                    {stage.value.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
