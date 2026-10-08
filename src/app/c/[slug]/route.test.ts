import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => fn() }
})
vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  getAssignedVariantId: vi.fn(),
  getLatestTrackingId: vi.fn(),
  getLatestFunnelClick: vi.fn(),
  getOrAssignVariant: vi.fn(),
  insertClickEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, getAssignedVariantId, getLatestTrackingId, getLatestFunnelClick, getOrAssignVariant, insertClickEvent } from '@/lib/repo/redirect-repo'

const CHECKOUT_TEST = {
  id: 'test-1',
  slug: 'oferta-x',
  status: 'active' as const,
  fallback_url: null,
  test_type: 'checkout' as const,
  sales_page_url: 'https://example.com/vendas',
  sales_funnel_id: null,
  variants: [
    { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://pay.hub.la/aaa', is_control: true },
    { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://pay.hub.la/bbb', is_control: false },
  ],
}

function request(cookie?: string) {
  return new NextRequest('https://ir.example.com/c/oferta-x', cookie ? { headers: { cookie } } : undefined)
}

const params = { params: Promise.resolve({ slug: 'oferta-x' }) }

describe('GET /c/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTestBySlug).mockResolvedValue(CHECKOUT_TEST)
    vi.mocked(getAssignedVariantId).mockResolvedValue(null)
    vi.mocked(getLatestTrackingId).mockResolvedValue(null)
  })

  it('sends an assigned visitor to their own checkout with the tracking id', async () => {
    vi.mocked(getLatestTrackingId).mockResolvedValue({ trackingId: 'trk_1', sourceUtms: {} })

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('falls back to the stored assignment when only the visitor cookie survives', async () => {
    vi.mocked(getAssignedVariantId).mockResolvedValue('v2')
    vi.mocked(getLatestTrackingId).mockResolvedValue({ trackingId: 'trk_1', sourceUtms: {} })

    const response = await GET(request('ir_vid=visitor-1'), params)

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('forwards the original click utms onto the final checkout link', async () => {
    vi.mocked(getLatestTrackingId).mockResolvedValue({
      trackingId: 'trk_1',
      sourceUtms: { utm_source: 'facebookads', utm_medium: 'cpc', utm_campaign: '1K_Latam', utm_term: 'Anuncio 1' },
    })

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('utm_source')).toBe('facebookads')
    expect(location.searchParams.get('utm_medium')).toBe('cpc')
    expect(location.searchParams.get('utm_campaign')).toBe('1K_Latam')
    expect(location.searchParams.get('utm_term')).toBe('Anuncio 1')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('sends an organic visitor with no cookie to the control checkout, untracked', async () => {
    const response = await GET(request(), params)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://pay.hub.la/aaa')
    expect(getLatestTrackingId).not.toHaveBeenCalled()
  })

  it('sends a visitor whose assigned variant was removed to the control checkout', async () => {
    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=deleted-variant'), params)

    expect(response.headers.get('location')).toBe('https://pay.hub.la/aaa')
  })

  it('sends an organic visitor to the first variant when no variant is marked as control', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      ...CHECKOUT_TEST,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://pay.hub.la/aaa', is_control: false },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://pay.hub.la/bbb', is_control: false },
      ],
    })

    const response = await GET(request(), params)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://pay.hub.la/aaa')
    expect(getLatestTrackingId).not.toHaveBeenCalled()
  })

  it('keeps redirecting when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({ ...CHECKOUT_TEST, status: 'paused' })
    vi.mocked(getLatestTrackingId).mockResolvedValue({ trackingId: 'trk_1', sourceUtms: {} })

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
  })

  it('redirects without a tracking id when the click event was never recorded', async () => {
    vi.mocked(getLatestTrackingId).mockResolvedValue(null)

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.headers.get('location')).toBe('https://pay.hub.la/bbb')
  })

  it('returns 404 for a test that does not exist', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue(null)
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })

  it('returns 404 for a page-mode test', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      ...CHECKOUT_TEST,
      test_type: 'page' as const,
      sales_page_url: null,
      sales_funnel_id: null,
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })

  describe('layers: a checkout test linked to a project (0078)', () => {
    const LAYERED = { ...CHECKOUT_TEST, sales_funnel_id: 'funnel-1' }

    it('enters a visitor of the project page test, drawn by weight, keeping the page click as parent', async () => {
      vi.mocked(getTestBySlug).mockResolvedValue(LAYERED)
      vi.mocked(getAssignedVariantId).mockResolvedValue(null)
      vi.mocked(getLatestFunnelClick).mockResolvedValue({ trackingId: 'page-click', sourceUtms: { utm_source: 'facebookads', utm_campaign: '120' } })
      vi.mocked(getOrAssignVariant).mockResolvedValue('v2')

      const response = await GET(request('ir_vid=visitor-1'), { params: Promise.resolve({ slug: 'oferta-x' }) })

      const location = new URL(response.headers.get('location')!)
      expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
      expect(location.searchParams.get('utm_source')).toBe('facebookads')
      const trackingId = location.searchParams.get('utm_content')
      expect(trackingId).toBeTruthy()
      expect(trackingId).not.toBe('page-click')
      expect(insertClickEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ testId: 'test-1', variantId: 'v2', visitorId: 'visitor-1', trackingId, parentTrackingId: 'page-click' })
      )
      expect(response.cookies.get('ir_t_oferta-x')?.value).toBe('v2')
    })

    it('sends a paused layered test to the control carrying the page click, entering no one', async () => {
      vi.mocked(getTestBySlug).mockResolvedValue({ ...LAYERED, status: 'paused' })
      vi.mocked(getAssignedVariantId).mockResolvedValue(null)
      vi.mocked(getLatestFunnelClick).mockResolvedValue({ trackingId: 'page-click', sourceUtms: {} })

      const response = await GET(request('ir_vid=visitor-1'), { params: Promise.resolve({ slug: 'oferta-x' }) })

      const location = new URL(response.headers.get('location')!)
      expect(location.origin + location.pathname).toBe('https://pay.hub.la/aaa')
      expect(location.searchParams.get('utm_content')).toBe('page-click')
      expect(insertClickEvent).not.toHaveBeenCalled()
    })

    it('leaves an unlinked test as before: an unknown visitor goes to the control, untracked', async () => {
      vi.mocked(getTestBySlug).mockResolvedValue(CHECKOUT_TEST)
      vi.mocked(getAssignedVariantId).mockResolvedValue(null)
      const response = await GET(request('ir_vid=visitor-1'), { params: Promise.resolve({ slug: 'oferta-x' }) })
      expect(new URL(response.headers.get('location')!).searchParams.get('utm_content')).toBeNull()
      expect(getLatestFunnelClick).not.toHaveBeenCalled()
      expect(insertClickEvent).not.toHaveBeenCalled()
    })
  })
})
