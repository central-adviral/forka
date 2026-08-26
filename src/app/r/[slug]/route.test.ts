import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  insertClickEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, insertClickEvent } from '@/lib/repo/redirect-repo'

describe('GET /r/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects to a variant and appends the tracking id', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })

    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
    expect(insertClickEvent).toHaveBeenCalledOnce()
  })

  it('returns 404 when the test is missing and there is no fallback', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue(null)
    const request = new NextRequest('https://ir.example.com/r/missing')
    const response = await GET(request, { params: Promise.resolve({ slug: 'missing' }) })
    expect(response.status).toBe(404)
  })

  it('redirects to the fallback url when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'paused',
      fallback_url: 'https://example.com/fallback',
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/fallback')
  })

  it('reuses the previously assigned variant from the cookie', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://example.com/b' },
      ],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { cookie: 'ir_t_oferta-x=v2' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/b')
  })

  it('redirects a known bot without recording a click event or setting cookies', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeNull()
    expect(insertClickEvent).not.toHaveBeenCalled()
    expect(response.cookies.get('ir_vid')).toBeUndefined()
  })

  it('redirects a known bot to the fallback url when set', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: 'https://example.com/fallback',
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'curl/8.4.0' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.headers.get('location')).toBe('https://example.com/fallback')
    expect(insertClickEvent).not.toHaveBeenCalled()
  })
})
