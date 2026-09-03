import { describe, it, expect } from 'vitest'
import { joinAdCreativeSpend, type LaunchOpsAdCreative, type LaunchOpsAdCreativeSpendRow } from './sync-ad-creative-spend'

describe('joinAdCreativeSpend', () => {
  it('attaches ad_id/ad_name to each spend row via anuncio_id, and drops rows with no matching creative', () => {
    const creatives: LaunchOpsAdCreative[] = [{ id: 'anuncio-1', ad_id: '12345', ad_name: 'Criativo A' }]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-1', data_referencia: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5, updated_at: '2026-09-01T00:00:00Z' },
      { anuncio_id: 'anuncio-orphan', data_referencia: '2026-09-01', spend: 5, impressions: 50, link_clicks: 1, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result).toEqual([
      { ad_id: '12345', ad_name: 'Criativo A', data: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5 },
    ])
  })
})
