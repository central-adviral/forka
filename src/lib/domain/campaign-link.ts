// What the ad's URL template puts on the link and /r/[slug] keeps on the click. One list, so the
// generator and the collector cannot drift: they drifted once already, and the human branch of the
// redirect spent that drift throwing away utm_content -- the adset name -- on every real visitor.
export const TRACKED_URL_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fb_ad_id',
  'fb_adset_id',
  'fb_campaign_id',
] as const

export type TrackedUrlParam = (typeof TRACKED_URL_PARAMS)[number]
export type CampaignLinkTemplate = Partial<Record<TrackedUrlParam, string>>

// Four slots carry a name, which a person reads and which changes when someone renames the ad.
// One carries an id, which the machine joins on and which never changes. utm_campaign is the slot
// that used to hold a hand-typed label naming something the sale already states in `produto`.
export const META_ADS_TEMPLATE: CampaignLinkTemplate = {
  utm_source: 'facebookads',
  utm_medium: '{{campaign.name}}',
  utm_campaign: '{{ad.id}}',
  utm_term: '{{ad.name}}',
  utm_content: '{{adset.name}}',
  fb_ad_id: '{{ad.id}}',
  fb_adset_id: '{{adset.id}}',
  fb_campaign_id: '{{campaign.id}}',
}

// Meta only substitutes a macro whose braces reach it verbatim; percent-encoded, the ad sends the
// literal "%7B%7Bad.id%7D%7D" and every click lands with no ad id at all.
function encodeParamValue(value: string): string {
  return encodeURIComponent(value).replace(/%7B/g, '{').replace(/%7D/g, '}')
}

export function buildCampaignUrl(baseUrl: string, template: CampaignLinkTemplate): string {
  const pairs = TRACKED_URL_PARAMS.filter((key) => template[key]).map(
    (key) => `${key}=${encodeParamValue(template[key]!)}`
  )
  if (pairs.length === 0) return baseUrl

  const [path, existingQuery] = baseUrl.split('?')
  const query = [existingQuery, ...pairs].filter(Boolean).join('&')
  return `${path}?${query}`
}

export interface CampaignUrlReport {
  valid: boolean
  present: TrackedUrlParam[]
  missing: TrackedUrlParam[]
  /** Whether the link carries something the report can resolve to a single ad. */
  carriesAdId: boolean
}

// Migration 0049 reads the ad id as a trailing run of six or more digits, so a label-prefixed id
// still resolves. A label with no such run -- "1K_Latam", "WM-12-26" -- resolves to nothing.
const AD_ID_PATTERN = /\d{6,}$/
const AD_ID_MACRO = '{{ad.id}}'

function hasAdId(params: URLSearchParams): boolean {
  return ['utm_campaign', 'fb_ad_id'].some((key) => {
    const value = params.get(key)?.trim()
    if (!value) return false
    return value === AD_ID_MACRO || AD_ID_PATTERN.test(value)
  })
}

export function inspectCampaignUrl(url: string): CampaignUrlReport {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, present: [], missing: [...TRACKED_URL_PARAMS], carriesAdId: false }
  }

  // A parameter that is there but empty is worse than absent: the link looks tagged and carries
  // nothing, so it never surfaces as a problem.
  const present = TRACKED_URL_PARAMS.filter((key) => (parsed.searchParams.get(key) ?? '').trim() !== '')
  const missing = TRACKED_URL_PARAMS.filter((key) => !present.includes(key))

  return { valid: true, present, missing, carriesAdId: hasAdId(parsed.searchParams) }
}
