export interface RankableCreative {
  ad_name: string
  adset_name: string | null
  spend: number
  sales_count: number
}

// One sale makes any CPA look great or awful; the CPA ranking only counts ads past that.
export const MIN_SALES_FOR_CPA = 2

export function topBySales<T extends RankableCreative>(creatives: T[], limit = 10): T[] {
  return creatives.filter((c) => c.sales_count > 0).sort((a, b) => b.sales_count - a.sales_count || a.spend - b.spend).slice(0, limit)
}

export function topByCpa<T extends RankableCreative>(creatives: T[], limit = 10): (T & { cpa: number })[] {
  return creatives
    .filter((c) => c.sales_count >= MIN_SALES_FOR_CPA && c.spend > 0)
    .map((c) => ({ ...c, cpa: c.spend / c.sales_count }))
    .sort((a, b) => a.cpa - b.cpa)
    .slice(0, limit)
}
