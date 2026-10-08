import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => fn() }
})
vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  insertClickEvent: vi.fn(),
  getOrAssignVariant: vi.fn(),
  countRecentClickEventsByIp: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, insertClickEvent, getOrAssignVariant, countRecentClickEventsByIp } from '@/lib/repo/redirect-repo'

describe('GET /r/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countRecentClickEventsByIp).mockResolvedValue(0)
  })

  it('redirects to a variant and appends the tracking id', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
    expect(insertClickEvent).toHaveBeenCalledOnce()
    expect(insertClickEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rateLimited: false }))
  })

  it('forwards utm_source, utm_medium, utm_campaign and utm_term from the incoming ad click', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest(
      'https://ir.example.com/r/oferta-x?utm_source=facebookads&utm_medium=cpc&utm_campaign=1K_Latam&utm_term=Anuncio%201'
    )
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('utm_source')).toBe('facebookads')
    expect(location.searchParams.get('utm_medium')).toBe('cpc')
    expect(location.searchParams.get('utm_campaign')).toBe('1K_Latam')
    expect(location.searchParams.get('utm_term')).toBe('Anuncio 1')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
  })

  it('captures fb_ad_id, fb_adset_id and fb_campaign_id from the incoming ad click', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest(
      'https://ir.example.com/r/oferta-x?fb_ad_id=120210000000001&fb_adset_id=120210000000002&fb_campaign_id=120210000000003'
    )
    await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(insertClickEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceUtms: expect.objectContaining({
          fb_ad_id: '120210000000001',
          fb_adset_id: '120210000000002',
          fb_campaign_id: '120210000000003',
        }),
      })
    )
  })

  it('forwards fb_ad_id onto the destination url alongside the standard utms', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest('https://ir.example.com/r/oferta-x?fb_ad_id=120210000000001')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('fb_ad_id')).toBe('120210000000001')
  })

  it('returns 404 when the test is missing and there is no fallback', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue(null)
    const request = new NextRequest('https://ir.example.com/r/missing')
    const response = await GET(request, { params: Promise.resolve({ slug: 'missing' }) })
    expect(response.status).toBe(404)
  })

  it('redirects to the fallback url, keeping the ad utms, when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'paused',
      fallback_url: 'https://example.com/fallback',
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x?utm_source=facebookads')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/fallback?utm_source=facebookads')
    expect(insertClickEvent).not.toHaveBeenCalled()
  })

  it('sends a paused test without fallback to the control, with the utms and no tracking id', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'paused',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: false },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: true },
      ],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x?utm_source=facebookads')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/b')
    expect(location.searchParams.get('utm_source')).toBe('facebookads')
    expect(location.searchParams.get('utm_content')).toBeNull()
    expect(insertClickEvent).not.toHaveBeenCalled()
  })

  it('reuses the previously assigned variant from the cookie', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: false },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
      ],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { cookie: 'ir_t_oferta-x=v2' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/b')
  })

  it('still records a click over the ip rate limit, flagged, so its sale keeps a variant', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')
    vi.mocked(countRecentClickEventsByIp).mockResolvedValue(999)

    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(insertClickEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rateLimited: true }))
  })

  it('redirects a known bot but records the click as a bot, without setting cookies', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeNull()
    expect(insertClickEvent).toHaveBeenCalledOnce()
    expect(insertClickEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isBot: true }))
    expect(response.cookies.get('ir_vid')).toBeUndefined()
  })

  it('sends a known bot to the control page people see, not to the fallback, recording it on the control', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: 'https://example.com/fallback',
      test_type: 'page',
      sales_page_url: null,
      sales_funnel_id: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: false },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: true },
      ],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'curl/8.4.0' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.headers.get('location')).toBe('https://example.com/b')
    expect(insertClickEvent).toHaveBeenCalledOnce()
    expect(insertClickEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isBot: true, variantId: 'v2' }))
  })

  it('sends a checkout test to the shared sales page, not to the variant checkout link', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'checkout',
      sales_page_url: 'https://example.com/vendas',
      sales_funnel_id: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://pay.hub.la/abc', is_control: true },
      ],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/vendas')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
    expect(insertClickEvent).toHaveBeenCalledOnce()
  })

  it('sends a bot on a checkout test to the sales page, never to the checkout link', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'checkout',
      sales_page_url: 'https://example.com/vendas',
      sales_funnel_id: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://pay.hub.la/abc', is_control: true },
      ],
    })

    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.headers.get('location')).toBe('https://example.com/vendas')
    expect(insertClickEvent).toHaveBeenCalledOnce()
    expect(insertClickEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isBot: true }))
  })
})
