import { describe, it, expect } from 'vitest'
import { HublaIrrelevantEventError, HublaMalformedPayloadError, verifyHublaToken, parseHublaPaymentSucceeded } from './hubla'

describe('verifyHublaToken', () => {
  it('returns true when tokens match', () => {
    expect(verifyHublaToken('secret', 'secret')).toBe(true)
  })
  it('returns false when tokens differ', () => {
    expect(verifyHublaToken('wrong', 'secret')).toBe(false)
  })
  it('returns false when token is missing', () => {
    expect(verifyHublaToken(null, 'secret')).toBe(false)
  })
  it('returns false when lengths differ', () => {
    expect(verifyHublaToken('short', 'a-much-longer-secret')).toBe(false)
  })
  it('returns false instead of throwing when the expected token is unset', () => {
    expect(verifyHublaToken('anything', undefined)).toBe(false)
  })
})

describe('parseHublaPaymentSucceeded', () => {
  it('extracts tracking id, external event id and value from a real payload shape', () => {
    const payload = {
      type: 'invoice.payment_succeeded',
      event: {
        invoice: {
          id: 'inv_123',
          amount: { totalCents: 9700 },
          paymentSession: { utm: { content: 'trk_abc' } },
        },
      },
    }
    expect(parseHublaPaymentSucceeded(payload)).toEqual({
      trackingId: 'trk_abc',
      externalEventId: 'inv_123',
      valueCents: 9700,
    })
  })

  it('falls back to firstPaymentSession if paymentSession is absent', () => {
    const payload = {
      type: 'invoice.payment_succeeded',
      event: {
        invoice: {
          id: 'inv_123',
          amount: { totalCents: 9700 },
          firstPaymentSession: { utm: { content: 'trk_abc' } },
        },
      },
    }
    expect(parseHublaPaymentSucceeded(payload).trackingId).toBe('trk_abc')
  })

  it('returns null tracking id when utm is missing', () => {
    const payload = {
      type: 'invoice.payment_succeeded',
      event: { invoice: { id: 'inv_456', amount: { totalCents: 100 } } },
    }
    expect(parseHublaPaymentSucceeded(payload).trackingId).toBeNull()
  })

  it('throws HublaMalformedPayloadError when invoice id is missing, distinct from an irrelevant event', () => {
    const payload = { type: 'invoice.payment_succeeded', event: { invoice: {} } }
    expect(() => parseHublaPaymentSucceeded(payload)).toThrow(HublaMalformedPayloadError)
  })

  it('rejects a refund event with HublaIrrelevantEventError, not a malformed-payload error', () => {
    const payload = {
      type: 'invoice.refunded',
      event: { invoice: { id: 'inv_1', firstPaymentSession: { utm: { content: 'trk_1' } } } },
    }
    expect(() => parseHublaPaymentSucceeded(payload)).toThrow(HublaIrrelevantEventError)
  })

  it('rejects a payload with no event type at all as an irrelevant event', () => {
    const payload = { event: { invoice: { id: 'inv_1' } } }
    expect(() => parseHublaPaymentSucceeded(payload)).toThrow(HublaIrrelevantEventError)
  })
})
