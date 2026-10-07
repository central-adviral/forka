export interface TrafficDayInput {
  data: string
  /** With tax. */
  spend: number
  impressions: number
  linkClicks: number
  landingPageViews: number
  initiateCheckout: number
  leads: number
  /** Entry sales; null for a front, since sales belong to the project. */
  vendas: number | null
}

export interface TrafficDay extends TrafficDayInput {
  cpm: number | null
  ctr: number | null
  connectRate: number | null
  pvToIc: number | null
  cpl: number | null
  cpa: number | null
}

const ratio = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : null)

function derive(day: TrafficDayInput): TrafficDay {
  return {
    ...day,
    cpm: ratio(day.spend * 1000, day.impressions),
    ctr: ratio(day.linkClicks * 100, day.impressions),
    connectRate: ratio(day.landingPageViews * 100, day.linkClicks),
    pvToIc: ratio(day.initiateCheckout * 100, day.landingPageViews),
    cpl: ratio(day.spend, day.leads),
    cpa: day.vendas === null ? null : ratio(day.spend, day.vendas),
  }
}

/** Each day with its rates, plus the period total, whose rates come from the summed counts. */
export function buildTrafficDays(days: TrafficDayInput[]): { days: TrafficDay[]; total: TrafficDay } {
  const total = days.reduce<TrafficDayInput>(
    (sum, day) => ({
      data: 'total',
      spend: sum.spend + day.spend,
      impressions: sum.impressions + day.impressions,
      linkClicks: sum.linkClicks + day.linkClicks,
      landingPageViews: sum.landingPageViews + day.landingPageViews,
      initiateCheckout: sum.initiateCheckout + day.initiateCheckout,
      leads: sum.leads + day.leads,
      vendas: day.vendas === null || sum.vendas === null ? null : sum.vendas + day.vendas,
    }),
    { data: 'total', spend: 0, impressions: 0, linkClicks: 0, landingPageViews: 0, initiateCheckout: 0, leads: 0, vendas: days.length > 0 && days[0].vendas === null ? null : 0 }
  )
  return { days: days.map(derive), total: derive(total) }
}
