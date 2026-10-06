import { describe, it, expect } from 'vitest'
import { aggregateCampaignDays, attachCheckouts, syncWindowStart, type LaunchOpsCampaignRow } from './sync-campaigns'

function row(overrides: Partial<LaunchOpsCampaignRow>): LaunchOpsCampaignRow {
  return {
    data_referencia: '2026-10-01',
    campaign_id: 'c1',
    campaign_name: '01 - [MTV-T15][GER][CAPTACAO]',
    spend: 100,
    impressions: 1000,
    clicks: 20,
    link_clicks: 15,
    landing_page_views: 10,
    leads_periodo: 4,
    reach: 800,
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

describe('aggregateCampaignDays', () => {
  it('sums the ad sets of one campaign on one day into a single row', () => {
    const result = aggregateCampaignDays([row({}), row({ spend: '50.5', impressions: 500, leads_periodo: 1 })])
    expect(result).toEqual([
      {
        data: '2026-10-01',
        campaign_id: 'c1',
        campaign_name: '01 - [MTV-T15][GER][CAPTACAO]',
        spend: 150.5,
        impressions: 1500,
        clicks: 40,
        link_clicks: 30,
        landing_page_views: 20,
        leads: 5,
        reach: 1600,
        initiate_checkout: 0,
      },
    ])
  })

  it('keeps days and campaigns apart', () => {
    const result = aggregateCampaignDays([row({}), row({ data_referencia: '2026-10-02' }), row({ campaign_id: 'c2' })])
    expect(result).toHaveLength(3)
  })

  it('takes the most recently updated name when a campaign was renamed', () => {
    const result = aggregateCampaignDays([
      row({ campaign_name: 'nome novo', updated_at: '2026-10-01T12:00:00Z' }),
      row({ campaign_name: 'nome antigo', updated_at: '2026-10-01T08:00:00Z' }),
    ])
    expect(result[0].campaign_name).toBe('nome novo')
  })

  it('skips rows without a campaign id, which cannot be classified', () => {
    expect(aggregateCampaignDays([row({ campaign_id: null })])).toEqual([])
  })

  it('treats missing numbers as zero', () => {
    const result = aggregateCampaignDays([row({ spend: null, impressions: null, leads_periodo: null })])
    expect(result[0]).toMatchObject({ spend: 0, impressions: 0, leads: 0 })
  })
})

describe('syncWindowStart', () => {
  // 02:00 UTC on Oct 6 is still Oct 5 in São Paulo.
  const now = new Date('2026-10-06T02:00:00Z')

  it('re-reads the last 7 São Paulo days once the client has history', () => {
    expect(syncWindowStart(true, now)).toBe('2026-09-28')
  })

  it('loads 60 days the first time', () => {
    expect(syncWindowStart(false, now)).toBe('2026-08-06')
  })
})

describe('attachCheckouts', () => {
  it('adds the initiate checkouts of every ad of the campaign on that day', () => {
    const days = aggregateCampaignDays([row({}), row({ campaign_id: 'c2' })])
    const result = attachCheckouts(days, [
      { data_referencia: '2026-10-01', initiate_checkout: 3, anuncio: { campaign_id: 'c1' } },
      { data_referencia: '2026-10-01', initiate_checkout: 2, anuncio: { campaign_id: 'c1' } },
      { data_referencia: '2026-10-02', initiate_checkout: 9, anuncio: { campaign_id: 'c1' } },
      { data_referencia: '2026-10-01', initiate_checkout: 7, anuncio: null },
    ])
    expect(result.find((day) => day.campaign_id === 'c1')!.initiate_checkout).toBe(5)
    expect(result.find((day) => day.campaign_id === 'c2')!.initiate_checkout).toBe(0)
  })
})
