// Reads the classification that get_client_campaigns (0053) computed. The matching itself lives in
// SQL only, so the rules screen, the reports and any future alert can never disagree about it.

export interface ClassifiedCampaign {
  campaign_id: string
  campaign_name: string
  spend: number
  leads: number
  last_day: string
  front_ids: string[]
}

export interface FrontSummary {
  campaigns: number
  spend: number
  leads: number
}

export function summarizeFronts(campaigns: ClassifiedCampaign[], frontIds: string[]): Map<string, FrontSummary> {
  const summary = new Map(frontIds.map((id) => [id, { campaigns: 0, spend: 0, leads: 0 }]))
  for (const campaign of campaigns) {
    for (const frontId of campaign.front_ids) {
      const front = summary.get(frontId)
      if (!front) continue
      front.campaigns += 1
      front.spend += Number(campaign.spend)
      front.leads += Number(campaign.leads)
    }
  }
  return summary
}

/** Campaigns counted by more than one front, at least one of them in this project. */
export function conflictingCampaigns(campaigns: ClassifiedCampaign[], projectFrontIds: Set<string>): ClassifiedCampaign[] {
  return campaigns.filter(
    (campaign) => campaign.front_ids.length > 1 && campaign.front_ids.some((id) => projectFrontIds.has(id))
  )
}

/** Campaigns with spend that no front of any project of the client counts. */
export function orphanCampaigns(campaigns: ClassifiedCampaign[]): ClassifiedCampaign[] {
  return campaigns.filter((campaign) => campaign.front_ids.length === 0)
}

/** The bracketed tags of the naming convention ([MTV-T15], [GER]...), ranked by the spend they carry. */
export function bracketTags(campaigns: ClassifiedCampaign[], limit = 16): { tag: string; spend: number; campaigns: number }[] {
  const tags = new Map<string, { spend: number; campaigns: number }>()
  for (const campaign of campaigns) {
    const seen = new Set(campaign.campaign_name.match(/\[[^\]]+\]/g) ?? [])
    for (const tag of seen) {
      const current = tags.get(tag) ?? { spend: 0, campaigns: 0 }
      current.spend += Number(campaign.spend)
      current.campaigns += 1
      tags.set(tag, current)
    }
  }
  return [...tags.entries()]
    .map(([tag, value]) => ({ tag, ...value }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit)
}
