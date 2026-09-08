import { describe, it, expect } from 'vitest'
import {
  TRACKED_URL_PARAMS,
  META_ADS_TEMPLATE,
  buildCampaignUrl,
  inspectCampaignUrl,
} from './campaign-link'

const BASE = 'https://ir.gustavovoe.com.br/r/pv-teste'

describe('TRACKED_URL_PARAMS', () => {
  it('carries the adset name, which the human branch of the click used to throw away', () => {
    expect(TRACKED_URL_PARAMS).toContain('utm_content')
  })

  it('lists every slot the Meta template fills', () => {
    for (const key of Object.keys(META_ADS_TEMPLATE)) {
      expect(TRACKED_URL_PARAMS).toContain(key)
    }
  })
})

describe('buildCampaignUrl', () => {
  it('appends every tracked parameter to a bare link', () => {
    const url = buildCampaignUrl(BASE, META_ADS_TEMPLATE)
    for (const key of TRACKED_URL_PARAMS) {
      expect(url).toContain(`${key}=`)
    }
  })

  // Meta substitutes the macro on the click only if the braces survive the URL verbatim.
  // URLSearchParams would percent-encode them into %7B%7B, and the ad would send that literal
  // string instead of the ad id -- exactly the failure this screen exists to prevent.
  it('leaves the macro braces unencoded', () => {
    const url = buildCampaignUrl(BASE, META_ADS_TEMPLATE)
    expect(url).toContain('utm_campaign={{ad.id}}')
    expect(url).toContain('utm_term={{ad.name}}')
    expect(url).not.toContain('%7B')
  })

  it('keeps the base path and adds a single query separator', () => {
    const url = buildCampaignUrl(BASE, META_ADS_TEMPLATE)
    expect(url.startsWith(`${BASE}?`)).toBe(true)
    expect(url.split('?')).toHaveLength(2)
  })

  it('merges into a base that already carries a query string', () => {
    const url = buildCampaignUrl(`${BASE}?ref=bio`, META_ADS_TEMPLATE)
    expect(url).toContain('ref=bio')
    expect(url).toContain('utm_source=')
    expect(url.split('?')).toHaveLength(2)
  })

  it('omits slots the template leaves blank', () => {
    const url = buildCampaignUrl(BASE, { utm_source: 'facebookads', utm_term: '' })
    expect(url).toBe(`${BASE}?utm_source=facebookads`)
  })

  it('returns the base untouched when the template is empty', () => {
    expect(buildCampaignUrl(BASE, {})).toBe(BASE)
  })
})

describe('inspectCampaignUrl', () => {
  it('reports every tracked parameter as present on a link built from the template', () => {
    const result = inspectCampaignUrl(buildCampaignUrl(BASE, META_ADS_TEMPLATE))
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.present).toEqual([...TRACKED_URL_PARAMS])
  })

  it('names what a half-tagged link is missing', () => {
    const result = inspectCampaignUrl(`${BASE}?utm_source=facebook&utm_term=Stories`)
    expect(result.present).toEqual(['utm_source', 'utm_term'])
    expect(result.missing).toContain('utm_content')
    expect(result.missing).toContain('fb_ad_id')
    expect(result.missing).toContain('utm_medium')
  })

  // A parameter that is there but empty is worse than absent: it looks tagged and carries nothing.
  it('counts a present-but-empty parameter as missing', () => {
    const result = inspectCampaignUrl(`${BASE}?utm_source=facebook&utm_term=`)
    expect(result.present).toEqual(['utm_source'])
    expect(result.missing).toContain('utm_term')
  })

  it('rejects a string that is not a URL', () => {
    const result = inspectCampaignUrl('nao e uma url')
    expect(result.valid).toBe(false)
    expect(result.present).toEqual([])
  })

  it('rejects an empty string without throwing', () => {
    expect(inspectCampaignUrl('').valid).toBe(false)
  })

  // The report reads the ad id as a trailing run of six or more digits (migration 0049), so it
  // accepts the bare id and a label-prefixed one. A hand-typed label carries no id at all, which
  // is the state that left R$ 16.512 of revenue without an ad.
  describe('the ad id slot', () => {
    it('accepts a bare numeric id', () => {
      expect(inspectCampaignUrl(`${BASE}?utm_campaign=120210987654321`).carriesAdId).toBe(true)
    })

    it('accepts an id behind a label prefix, as the report does', () => {
      expect(inspectCampaignUrl(`${BASE}?utm_campaign=1K_Latam-120210987654321`).carriesAdId).toBe(true)
    })

    it('accepts the unexpanded macro, since Meta fills it on the click', () => {
      expect(inspectCampaignUrl(`${BASE}?utm_campaign={{ad.id}}`).carriesAdId).toBe(true)
    })

    it('rejects a hand-typed label', () => {
      expect(inspectCampaignUrl(`${BASE}?utm_campaign=1K_Latam`).carriesAdId).toBe(false)
    })

    it('rejects a run of digits too short to be an ad id', () => {
      expect(inspectCampaignUrl(`${BASE}?utm_campaign=WM-12-26`).carriesAdId).toBe(false)
    })

    it('is false when the slot is absent', () => {
      expect(inspectCampaignUrl(BASE).carriesAdId).toBe(false)
    })

    it('reads fb_ad_id as the id slot too, so either one counts', () => {
      expect(inspectCampaignUrl(`${BASE}?fb_ad_id=120210987654321`).carriesAdId).toBe(true)
    })
  })
})
