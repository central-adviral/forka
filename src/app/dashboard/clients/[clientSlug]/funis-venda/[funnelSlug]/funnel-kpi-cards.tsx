interface KpiTotals {
  investimento: number
  /** True when a Meta tax rate is set for the client, so the investment above includes it. */
  comImposto: boolean
  receitaLiquida: number
  vendas: number
  vendasUpsell: number
  cpa: number | null
  cpaAnuncio: number | null
  /** Ad-looking entry sales with no identified campaign (0103): outside the ad CPA. */
  vendasAnuncioSemId: number
  resultado: number
  roas: number | null
  /** Front revenue plus the ascension product, over the same spend (0061). */
  roasComAscensao: number | null
  ticketMedio: number | null
}

/** A lead project reads its campaigns' paid leads instead of sales (0071). */
interface LeadTotals {
  leads: number
  linkClicks: number
  landingPageViews: number
}

interface KpiSparklines {
  receitaLiquida: number[]
  roas: number[]
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 64
  const h = 20
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1.5 block" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FunnelKpiCards({
  totals,
  currency,
  sparklines,
  lead,
}: {
  totals: KpiTotals
  currency: (value: number) => string
  sparklines?: KpiSparklines
  lead?: LeadTotals
}) {
  const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1).replace('.', ',')}%` : '—')
  const leadCards: { label: string; value: string; color?: string; hint?: string; spark?: { values: number[]; color: string } }[] = lead
    ? [
        { label: totals.comImposto ? 'Investimento c/ imposto' : 'Investimento (sem imposto)', value: currency(totals.investimento) },
        { label: 'Leads pagos', value: lead.leads.toLocaleString('pt-BR'), hint: 'das campanhas do funil, sem duplicata' },
        { label: 'CPL', value: lead.leads > 0 ? currency(totals.investimento / lead.leads) : '—', hint: 'investimento ÷ leads pagos' },
        { label: 'Cliques no link', value: lead.linkClicks.toLocaleString('pt-BR') },
        { label: 'Custo por clique', value: lead.linkClicks > 0 ? currency(totals.investimento / lead.linkClicks) : '—' },
        { label: 'View page', value: lead.landingPageViews.toLocaleString('pt-BR'), hint: `${percent(lead.landingPageViews, lead.linkClicks)} dos cliques` },
        { label: 'Conversão da página', value: percent(lead.leads, lead.landingPageViews), hint: 'leads ÷ view page' },
      ]
    : []
  const cards: { label: string; value: string; color?: string; hint?: string; spark?: { values: number[]; color: string } }[] = lead ? leadCards : [
    { label: totals.comImposto ? 'Investimento c/ imposto' : 'Investimento (sem imposto)', value: currency(totals.investimento) },
    {
      label: 'Receita líquida',
      hint: 'entrada + bump + upsell',
      value: currency(totals.receitaLiquida),
      spark: sparklines ? { values: sparklines.receitaLiquida, color: 'var(--ct-accent)' } : undefined,
    },
    {
      label: 'Vendas de entrada',
      value: totals.vendas.toLocaleString('pt-BR'),
      hint: totals.vendasUpsell > 0 ? `+ ${totals.vendasUpsell.toLocaleString('pt-BR')} upsell` : undefined,
    },
    { label: 'CPA geral', value: totals.cpa !== null ? currency(totals.cpa) : '—', hint: 'todas as vendas de entrada' },
    {
      label: 'CPA de anúncio',
      value: totals.cpaAnuncio !== null ? currency(totals.cpaAnuncio) : '—',
      hint:
        totals.vendasAnuncioSemId > 0
          ? `${totals.vendasAnuncioSemId.toLocaleString('pt-BR')} anúncio sem identificação (fora do CPA de anúncio)`
          : 'só vendas com a campanha identificada',
    },
    { label: 'Resultado', value: currency(totals.resultado), color: totals.resultado >= 0 ? 'var(--ct-ok)' : 'var(--ct-crit)' },
    {
      label: 'ROAS front',
      value: totals.roas !== null ? `${totals.roas.toFixed(2)}x` : '—',
      hint: totals.roasComAscensao !== null ? `c/ ascensão ${totals.roasComAscensao.toFixed(2)}x` : undefined,
      spark: sparklines ? { values: sparklines.roas, color: 'var(--ct-ok)' } : undefined,
    },
    { label: 'Ticket Médio', value: totals.ticketMedio !== null ? currency(totals.ticketMedio) : '—' },
  ]

  return (
    <div
      // The headline numbers get their own lifted surface with a violet edge, so the band reads
      // as the summary of the page rather than as one more panel among the charts.
      // One gap-px grid on a line-colored ground draws the dividers in any row count: 4 columns until
      // the screen is wide enough for 8 without a value spilling into its neighbor.
      className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-[color-mix(in_srgb,var(--ct-accent)_25%,var(--ct-line))] bg-[var(--ct-line)] sm:grid-cols-4 2xl:grid-cols-8"
      style={{ boxShadow: 'var(--ct-shadow)' }}
    >
      {cards.map((card) => (
        <div key={card.label} className="flex min-w-0 flex-col bg-[var(--ct-surface-3)] px-4 py-4">
          <div className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]" title={card.label}>
            {card.label}
          </div>
          <div
            className="truncate font-[family-name:var(--font-geist-mono)] text-[19px] font-semibold tabular-nums tracking-[-0.02em]"
            style={{ color: card.color ?? 'var(--ct-text)' }}
            title={card.value}
          >
            {card.value}
          </div>
          {card.hint && <div className="mt-0.5 text-[11px] text-[var(--ct-text-2)]">{card.hint}</div>}
          {card.spark && <Sparkline values={card.spark.values} color={card.spark.color} />}
        </div>
      ))}
    </div>
  )
}
