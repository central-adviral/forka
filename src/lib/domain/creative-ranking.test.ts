import { describe, it, expect } from 'vitest'
import { topByCpa, topBySales } from './creative-ranking'

const ad = (ad_name: string, spend: number, sales_count: number) => ({ ad_name, adset_name: null, spend, sales_count })

describe('creative ranking', () => {
  const creatives = [ad('A', 100, 10), ad('B', 30, 1), ad('C', 60, 4), ad('D', 50, 0)]

  it('ranks by purchases and leaves out ads with no sale', () => {
    expect(topBySales(creatives).map((c) => c.ad_name)).toEqual(['A', 'C', 'B'])
  })

  it('ranks by CPA only ads with at least two sales', () => {
    expect(topByCpa(creatives).map((c) => [c.ad_name, c.cpa])).toEqual([
      ['A', 10],
      ['C', 15],
    ])
  })
})
