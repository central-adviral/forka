import { describe, it, expect } from 'vitest'
import { HublaIrrelevantEventError, HublaMalformedPayloadError, verifyHublaToken, parseHublaPaymentSucceeded, parseHublaRefund } from './hubla'

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

describe('parseHublaRefund', () => {
  const refund = {
    type: 'invoice.refunded',
    event: {
      invoice: {
        id: '7614b1bb-1d1a-43ba-890c-50d74216eb56',
        status: 'refunded',
        statusAt: [
          { status: 'unpaid', when: '2024-03-28T20:35:22.671Z' },
          { status: 'paid', when: '2024-03-28T20:35:33.512Z' },
          { status: 'refunded', when: '2024-03-28T21:47:53.177Z' },
        ],
        modifiedAt: '2024-03-28T21:47:53.177Z',
      },
    },
    version: '2.0.0',
  }

  it('reads the invoice it undoes and when the refund happened', () => {
    expect(parseHublaRefund(refund)).toEqual({ externalEventId: '7614b1bb-1d1a-43ba-890c-50d74216eb56', refundedAt: '2024-03-28T21:47:53.177Z' })
  })

  it('ignores every other event, the payment included', () => {
    expect(parseHublaRefund({ ...refund, type: 'invoice.payment_succeeded' })).toBeNull()
    expect(parseHublaRefund({ type: 'subscription.created' })).toBeNull()
  })

  it('refuses a refund without the invoice id', () => {
    expect(() => parseHublaRefund({ type: 'invoice.refunded', event: { invoice: {} } })).toThrow('missing event.invoice.id')
  })
})

