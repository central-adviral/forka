import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  getAssignedVariantId: vi.fn(),
  getLatestTrackingId: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, getAssignedVariantId, getLatestTrackingId } from '@/lib/repo/redirect-repo'

const CHECKOUT_TEST = {
  id: 'test-1',
  slug: 'oferta-x',
  status: 'active' as const,
  fallback_url: null,
  test_type: 'checkout' as const,
  sales_page_url: 'https://example.com/vendas',
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
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('falls back to the stored assignment when only the visitor cookie survives', async () => {
    vi.mocked(getAssignedVariantId).mockResolvedValue('v2')
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

    const response = await GET(request('ir_vid=visitor-1'), params)

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
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

  it('keeps redirecting when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({ ...CHECKOUT_TEST, status: 'paused' })
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

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
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })
})
