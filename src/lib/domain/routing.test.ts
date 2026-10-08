import { describe, it, expect } from 'vitest'
import { deviceOf, matchRoute, type VariantRoute } from './routing'

const routes: VariantRoute[] = [
  { id: 'dor', match_field: 'ad_name', match_value: '[dor]', destination_url: 'https://x.com/dor' },
  { id: 'bio', match_field: 'utm_source', match_value: 'Instagram', destination_url: 'https://x.com/bio' },
  { id: 'cel', match_field: 'device', match_value: 'celular', destination_url: 'https://x.com/curta' },
]
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'

describe('matchRoute', () => {
  it('sends a [dor] ad to the pain page, whatever the case or accents', () => {
    expect(matchRoute(routes, { adName: 'UGC [DOR] v3', utmSource: 'facebookads', userAgent: mac })?.id).toBe('dor')
  })

  it('matches the source exactly, and the device from the browser', () => {
    expect(matchRoute(routes, { adName: 'Estúdio [ganho]', utmSource: 'instagram', userAgent: mac })?.id).toBe('bio')
    expect(matchRoute(routes, { adName: 'Estúdio [ganho]', utmSource: 'instagram_stories', userAgent: iphone })?.id).toBe('cel')
  })

  it('takes the first rule that matches, in order', () => {
    expect(matchRoute(routes, { adName: 'UGC [dor]', utmSource: 'instagram', userAgent: iphone })?.id).toBe('dor')
  })

  it('keeps the variant page when nothing matches', () => {
    expect(matchRoute(routes, { adName: 'Estúdio [ganho]', utmSource: 'facebookads', userAgent: mac })).toBeNull()
    expect(matchRoute([], { adName: '', utmSource: '', userAgent: null })).toBeNull()
  })
})

describe('deviceOf', () => {
  it('reads phones and tablets as celular, the rest as computador', () => {
    expect(deviceOf(iphone)).toBe('celular')
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('celular')
    expect(deviceOf(mac)).toBe('computador')
    expect(deviceOf(null)).toBe('computador')
  })
})
