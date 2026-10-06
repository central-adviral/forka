import { describe, it, expect } from 'vitest'
import { bracketTags, conflictingCampaigns, orphanCampaigns, summarizeFronts, type ClassifiedCampaign } from './campaign-rules'

function campaign(name: string, spend: number, frontIds: string[], leads = 0, suggested = frontIds): ClassifiedCampaign {
  return {
    campaign_id: name,
    campaign_name: name,
    spend,
    leads,
    last_day: '2026-10-05',
    front_ids: frontIds,
    suggested_front_ids: suggested,
    assignment: frontIds.length > 0 ? 'auto' : null,
  }
}

const campaigns = [
  campaign('01 - [MTV-T15][GER][CAPTACAO]', 100, ['ger'], 10),
  campaign('02 - [MTV-T15][GER][CAPTACAO]', 50, ['ger'], 4),
  campaign('03 - [1K-POR-DIA][T15][VENDA]', 80, ['pag', 'paga-t15']),
  campaign('04 - Teste_Criativo_Novo', 30, []),
  campaign('05 - [1K-POR-DIA][PRE] Remarketing', 20, [], 0, ['pag', 'pre']),
]

describe('summarizeFronts', () => {
  it('adds up campaigns, spend and leads per front of the project', () => {
    const summary = summarizeFronts(campaigns, ['ger', 'pag', 'pre'])
    expect(summary.get('ger')).toEqual({ campaigns: 2, spend: 150, leads: 14 })
    expect(summary.get('pag')).toEqual({ campaigns: 1, spend: 80, leads: 0 })
    expect(summary.get('pre')).toEqual({ campaigns: 0, spend: 0, leads: 0 })
  })

  it('counts the owner front and the front that reads its project, each in its own project', () => {
    expect(summarizeFronts(campaigns, ['paga-t15']).get('paga-t15')).toEqual({ campaigns: 1, spend: 80, leads: 0 })
  })

  it('ignores fronts of other projects', () => {
    expect(summarizeFronts(campaigns, ['ger']).has('paga-t15')).toBe(false)
  })
})

describe('conflictingCampaigns', () => {
  it('flags a campaign two fronts claim by name, while no front counts it', () => {
    expect(conflictingCampaigns(campaigns, new Set(['pre'])).map((c) => c.campaign_id)).toEqual(['05 - [1K-POR-DIA][PRE] Remarketing'])
  })

  it('stays quiet about conflicts that do not touch this project', () => {
    expect(conflictingCampaigns(campaigns, new Set(['ger']))).toEqual([])
  })
})

describe('orphanCampaigns', () => {
  it('lists campaigns with spend that no front counts', () => {
    expect(orphanCampaigns(campaigns).map((c) => c.campaign_name)).toEqual(['04 - Teste_Criativo_Novo'])
  })
})

describe('bracketTags', () => {
  it('ranks the naming tags by the spend behind them, counting a tag once per campaign', () => {
    expect(bracketTags(campaigns)).toEqual([
      { tag: '[MTV-T15]', spend: 150, campaigns: 2 },
      { tag: '[GER]', spend: 150, campaigns: 2 },
      { tag: '[CAPTACAO]', spend: 150, campaigns: 2 },
      { tag: '[1K-POR-DIA]', spend: 100, campaigns: 2 },
      { tag: '[T15]', spend: 80, campaigns: 1 },
      { tag: '[VENDA]', spend: 80, campaigns: 1 },
      { tag: '[PRE]', spend: 20, campaigns: 1 },
    ])
  })
})
