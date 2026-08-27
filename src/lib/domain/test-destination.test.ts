import { describe, it, expect } from 'vitest'
import { resolveEntryDestination, withTrackingId } from './test-destination'

describe('resolveEntryDestination', () => {
  it('uses the variant destination in page mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'page',
        salesPageUrl: null,
        variantDestinationUrl: 'https://example.com/page-a',
      })
    ).toBe('https://example.com/page-a')
  })

  it('ignores a sales page url in page mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'page',
        salesPageUrl: 'https://example.com/shared',
        variantDestinationUrl: 'https://example.com/page-a',
      })
    ).toBe('https://example.com/page-a')
  })

  it('uses the shared sales page in checkout mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'checkout',
        salesPageUrl: 'https://example.com/vendas',
        variantDestinationUrl: 'https://pay.hub.la/abc',
      })
    ).toBe('https://example.com/vendas')
  })

  it('falls back to the variant destination if a checkout test somehow has no sales page', () => {
    expect(
      resolveEntryDestination({
        testType: 'checkout',
        salesPageUrl: null,
        variantDestinationUrl: 'https://pay.hub.la/abc',
      })
    ).toBe('https://pay.hub.la/abc')
  })
})

describe('withTrackingId', () => {
  it('appends utm_content', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc', 'trk_1'))
    expect(result.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('preserves query params already present on the checkout link', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc?offer=annual', 'trk_1'))
    expect(result.searchParams.get('offer')).toBe('annual')
    expect(result.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('overwrites an existing utm_content rather than duplicating it', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc?utm_content=stale', 'trk_1'))
    expect(result.searchParams.getAll('utm_content')).toEqual(['trk_1'])
  })

  it('returns the url untouched when there is no tracking id', () => {
    expect(withTrackingId('https://pay.hub.la/abc', null)).toBe('https://pay.hub.la/abc')
  })
})
