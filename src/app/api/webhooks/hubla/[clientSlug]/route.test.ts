import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/domain/hubla', () => ({
  verifyHublaToken: vi.fn(),
  parseHublaPaymentSucceeded: vi.fn(),
  HublaIrrelevantEventError: class HublaIrrelevantEventError extends Error {},
}))
vi.mock('@/lib/repo/conversion-repo', () => ({
  getClickEventByTrackingId: vi.fn(),
  insertConversionIfNew: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockClientRow, error: null }),
        }),
      }),
    }),
  })),
}))

let mockClientRow: { id: string; hubla_webhook_token: string | null } | null

import { POST } from './route'
import { verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

function makeRequest(body: unknown, token = 'valid-token') {
  return new NextRequest('https://ir.example.com/api/webhooks/hubla/gustavo-voe', {
    method: 'POST',
    headers: { 'x-hubla-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/webhooks/hubla/[clientSlug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClientRow = { id: 'client-1', hubla_webhook_token: 'valid-token' }
  })

  it('returns 404 when the client slug does not exist', async () => {
    mockClientRow = null
    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'unknown' }) })
    expect(response.status).toBe(404)
  })

  it('returns 404 when the client has no Hubla token configured', async () => {
    mockClientRow = { id: 'client-1', hubla_webhook_token: null }
    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    expect(response.status).toBe(404)
  })

  it('rejects an invalid token with 401', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(false)
    const response = await POST(makeRequest({}, 'wrong-token'), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    expect(response.status).toBe(401)
  })

  it('does not attribute a click event belonging to a different client', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({ trackingId: 'trk_1', externalEventId: 'inv_1', valueCents: 1000 })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1', testSlug: 'oferta-x', clientId: 'other-client' })

    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: false })
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })

  it('records a conversion when the click event belongs to this client', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({ trackingId: 'trk_1', externalEventId: 'inv_1', valueCents: 1000 })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1', testSlug: 'oferta-x', clientId: 'client-1' })
    vi.mocked(insertConversionIfNew).mockResolvedValue('inserted')

    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: true, result: 'inserted' })
  })
})
