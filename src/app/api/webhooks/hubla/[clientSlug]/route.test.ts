import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/domain/hubla', () => ({
  verifyHublaToken: vi.fn(),
  parseHublaPaymentSucceeded: vi.fn(),
  HublaIrrelevantEventError: class HublaIrrelevantEventError extends Error {},
  HublaMalformedPayloadError: class HublaMalformedPayloadError extends Error {},
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
import { verifyHublaToken, parseHublaPaymentSucceeded, HublaIrrelevantEventError, HublaMalformedPayloadError } from '@/lib/domain/hubla'
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

  it('ignores sandbox events without recording a conversion', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    const request = new NextRequest('https://ir.example.com/api/webhooks/hubla/gustavo-voe', {
      method: 'POST',
      headers: { 'x-hubla-token': 'valid-token', 'x-hubla-sandbox': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invoice.payment_succeeded' }),
    })
    const response = await POST(request, { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, attributed: false })
    expect(parseHublaPaymentSucceeded).not.toHaveBeenCalled()
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })

  it('returns 422 instead of a silent 200 when the body is not JSON, so Hubla retries', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    const request = new NextRequest('https://ir.example.com/api/webhooks/hubla/gustavo-voe', {
      method: 'POST',
      headers: { 'x-hubla-token': 'valid-token', 'content-type': 'application/json' },
      body: 'not-json',
    })
    const response = await POST(request, { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(response.status).toBe(422)
    expect(json).toEqual({ ok: false, attributed: false })
  })

  it('returns attributed:false with 200 when the payload is simply not a payment_succeeded event', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockImplementation(() => {
      throw new HublaIrrelevantEventError('Hubla payload is not a payment_succeeded event: invoice.refunded')
    })

    const response = await POST(makeRequest({ type: 'invoice.refunded' }), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, attributed: false })
  })

  it('returns 422 instead of a silent 200 when a payment_succeeded payload is malformed, so Hubla retries', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockImplementation(() => {
      throw new HublaMalformedPayloadError('Hubla payload missing event.invoice.id')
    })

    const response = await POST(makeRequest({ type: 'invoice.payment_succeeded' }), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(response.status).toBe(422)
    expect(json).toEqual({ ok: false, attributed: false })
  })

  it('returns attributed:false when the tracking id matches no click event at all', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({ trackingId: 'trk_unknown', externalEventId: 'inv_1', valueCents: 1000 })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue(null)

    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: false })
    expect(insertConversionIfNew).not.toHaveBeenCalled()
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
