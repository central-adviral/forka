import { describe, it, expect } from 'vitest'
import { joinAdCreativeSpend, mergeAdLeads, type LaunchOpsAdCreative, type LaunchOpsAdCreativeSpendRow } from './sync-ad-creative-spend'

describe('joinAdCreativeSpend', () => {
  it('attaches ad_id/ad_name/campaign_id/campaign_name/adset_id/adset_name to each spend row via anuncio_id, and drops rows with no matching creative', () => {
    const creatives: LaunchOpsAdCreative[] = [
      {
        id: 'anuncio-1',
        ad_id: '12345',
        ad_name: 'Criativo A',
        campaign_id: 'camp-1',
        campaign_name: 'Campanha X',
        adset_id: 'adset-1',
        adset_name: 'Conjunto Y',
      },
    ]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-1', data_referencia: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5, updated_at: '2026-09-01T00:00:00Z' },
      { anuncio_id: 'anuncio-orphan', data_referencia: '2026-09-01', spend: 5, impressions: 50, link_clicks: 1, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result).toEqual([
      {
        ad_id: '12345',
        ad_name: 'Criativo A',
        campaign_id: 'camp-1',
        campaign_name: 'Campanha X',
        adset_id: 'adset-1',
        adset_name: 'Conjunto Y',
        data: '2026-09-01',
        spend: 20,
        impressions: 200,
        link_clicks: 5,
      },
    ])
  })

  it('passes through null campaign_id/adset_id when the LaunchOps ad record has no hierarchy set', () => {
    const creatives: LaunchOpsAdCreative[] = [
      { id: 'anuncio-2', ad_id: '999', ad_name: 'Criativo Antigo', campaign_id: null, campaign_name: null, adset_id: null, adset_name: null },
    ]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-2', data_referencia: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result[0].campaign_id).toBeNull()
    expect(result[0].campaign_name).toBeNull()
    expect(result[0].adset_id).toBeNull()
    expect(result[0].adset_name).toBeNull()
  })
})

describe('mergeAdLeads', () => {
  const creative: LaunchOpsAdCreative = { id: 'a1', ad_id: '120001', ad_name: 'Video [T4-A]', campaign_id: 'c1', campaign_name: 'GER', adset_id: 's1', adset_name: 'Aberto' }
  const row = { ad_id: '120001', ad_name: 'Video [T4-A]', campaign_id: 'c1', campaign_name: 'GER', adset_id: 's1', adset_name: 'Aberto', data: '2026-10-01', spend: 50, impressions: 1000, link_clicks: 20 }

  it('puts the leads on the same ad and day, keeps zero elsewhere, and adds a zero-spend row for a day without spend', () => {
    const merged = mergeAdLeads([row, { ...row, data: '2026-10-02' }], [creative], new Map([['2026-10-01|120001', 7], ['2026-10-03|120001', 2], ['2026-10-01|999', 4]]))
    expect(merged.map((r) => [r.data, r.spend, r.leads])).toEqual([
      ['2026-10-01', 50, 7],
      ['2026-10-02', 50, 0],
      ['2026-10-03', 0, 2],
    ])
  })
})
