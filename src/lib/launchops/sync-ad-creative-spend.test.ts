import { describe, it, expect } from 'vitest'
import { joinAdCreativeSpend, type LaunchOpsAdCreative, type LaunchOpsAdCreativeSpendRow } from './sync-ad-creative-spend'

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
