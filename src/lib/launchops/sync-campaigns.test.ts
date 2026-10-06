import { describe, it, expect } from 'vitest'
import { aggregateAdDays, countPaidLeads, syncWindowStart, windowDays, type LaunchOpsAdDayRow } from './sync-campaigns'

function row(overrides: Partial<LaunchOpsAdDayRow> = {}, campaignId: string | null = 'c1', name = '01 - [MTV-T15][GER][CAPTACAO]'): LaunchOpsAdDayRow {
  return {
    data_referencia: '2026-10-01',
    spend: 100,
    impressions: 1000,
    clicks: 20,
    reach: 800,
    link_clicks: 15,
    landing_page_views: 10,
    initiate_checkout: 2,
    updated_at: '2026-10-01T10:07:00Z',
    anuncio: { campaign_id: campaignId, campaign_name: name },
    ...overrides,
  }
}

describe('aggregateAdDays', () => {
  it('sums the ads of one campaign on one day into a single row, with the leads of its ad sets', () => {
    const result = aggregateAdDays(
      [row(), row({ spend: '50.5', impressions: 500, initiate_checkout: 1, updated_at: '2026-10-01T11:07:00Z' })],
      [
        { data_referencia: '2026-10-01', campaign_id: 'c1', leads_periodo: 3 },
        { data_referencia: '2026-10-01', campaign_id: 'c1', leads_periodo: 2 },
        { data_referencia: '2026-10-02', campaign_id: 'c1', leads_periodo: 9 },
      ]
    )
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
        initiate_checkout: 3,
        source_updated_at: '2026-10-01T11:07:00Z',
      },
    ])
  })

  it('keeps days and campaigns apart', () => {
    expect(aggregateAdDays([row(), row({ data_referencia: '2026-10-02' }), row({}, 'c2')])).toHaveLength(3)
  })

  it('takes the most recently updated name when a campaign was renamed', () => {
    const result = aggregateAdDays([
      row({ updated_at: '2026-10-01T12:00:00Z' }, 'c1', 'nome novo'),
      row({ updated_at: '2026-10-01T08:00:00Z' }, 'c1', 'nome antigo'),
    ])
    expect(result[0].campaign_name).toBe('nome novo')
  })

  it('skips ads without a campaign id, which cannot be classified', () => {
    expect(aggregateAdDays([row({}, null)])).toEqual([])
  })

  it('treats missing numbers as zero', () => {
    const result = aggregateAdDays([row({ spend: null, impressions: null, initiate_checkout: null })])
    expect(result[0]).toMatchObject({ spend: 0, impressions: 0, initiate_checkout: 0, leads: 0 })
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

describe('windowDays', () => {
  it('lists every São Paulo day of the window, so a day with no rows is still replaced', () => {
    expect(windowDays('2026-10-03', new Date('2026-10-06T02:00:00Z'))).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
  })
})

describe('countPaidLeads', () => {
  it('counts paid leads per São Paulo day and campaign, skipping leads with no campaign', () => {
    expect(
      countPaidLeads([
        { data_captacao: '2026-09-27T02:30:00Z', captacao_campaign: '120256561707910538' },
        { data_captacao: '2026-09-26T15:00:00Z', captacao_campaign: '120256561707910538' },
        { data_captacao: '2026-09-27T15:00:00Z', captacao_campaign: '120256561707910538' },
        { data_captacao: '2026-09-27T15:00:00Z', captacao_campaign: null },
      ])
    ).toEqual([
      { data_referencia: '2026-09-26', campaign_id: '120256561707910538', leads_periodo: 2 },
      { data_referencia: '2026-09-27', campaign_id: '120256561707910538', leads_periodo: 1 },
    ])
  })
})
