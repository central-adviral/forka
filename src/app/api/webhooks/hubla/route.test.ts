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
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { POST } from './route'
import { HublaIrrelevantEventError, HublaMalformedPayloadError, verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

function makeRequest(body: unknown, token = 'valid-token') {
  return new NextRequest('https://ir.example.com/api/webhooks/hubla', {
    method: 'POST',
    headers: { 'x-hubla-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/webhooks/hubla', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an invalid token with 401', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(false)
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(401)
  })

  it('returns 422 instead of a silent 200 when the body is not JSON, so Hubla retries', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    const request = new NextRequest('https://ir.example.com/api/webhooks/hubla', {
      method: 'POST',
      headers: { 'x-hubla-token': 'valid-token', 'content-type': 'application/json' },
      body: 'not-json',
    })
    const response = await POST(request)
    const json = await response.json()
    expect(response.status).toBe(422)
    expect(json).toEqual({ ok: false, attributed: false })
  })

  it('returns attributed:false with 200 when the payload is simply not a payment_succeeded event', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockImplementation(() => {
      throw new HublaIrrelevantEventError('Hubla payload is not a payment_succeeded event: invoice.refunded')
    })

    const response = await POST(makeRequest({ type: 'invoice.refunded' }))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true, attributed: false })
  })

  it('returns 422 instead of a silent 200 when a payment_succeeded payload is malformed, so Hubla retries', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockImplementation(() => {
      throw new HublaMalformedPayloadError('Hubla payload missing event.invoice.id')
    })

    const response = await POST(makeRequest({ type: 'invoice.payment_succeeded' }))
    const json = await response.json()
    expect(response.status).toBe(422)
    expect(json).toEqual({ ok: false, attributed: false })
  })

  it('returns attributed:false when tracking id is unknown', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({
      trackingId: 'trk_1',
      externalEventId: 'inv_1',
      valueCents: 1000,
    })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue(null)

    const response = await POST(makeRequest({}))
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: false })
  })

  it('records a conversion when tracking id matches a click event', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({
      trackingId: 'trk_1',
      externalEventId: 'inv_1',
      valueCents: 1000,
    })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1', testSlug: 'oferta-x' })
    vi.mocked(insertConversionIfNew).mockResolvedValue('inserted')

    const response = await POST(makeRequest({}))
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: true, result: 'inserted' })
    expect(insertConversionIfNew).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clickEventId: 'click_1', source: 'hubla_webhook' })
    )
  })
})
