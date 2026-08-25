import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/conversion-repo', () => ({
  getClickEventByTrackingId: vi.fn(),
  insertConversionIfNew: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

describe('GET /ty/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a conversion when tid matches a click event', async () => {
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1' })
    const request = new NextRequest('https://ir.example.com/ty/oferta-x?tid=trk_1')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.headers.get('content-type')).toBe('image/gif')
    expect(insertConversionIfNew).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clickEventId: 'click_1', source: 'thank_you_page' })
    )
  })

  it('still returns the pixel when tid is missing', async () => {
    const request = new NextRequest('https://ir.example.com/ty/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(200)
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })

  it('still returns the pixel when tid matches no click event', async () => {
    vi.mocked(getClickEventByTrackingId).mockResolvedValue(null)
    const request = new NextRequest('https://ir.example.com/ty/oferta-x?tid=unknown')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(200)
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })
})
