import { describe, it, expect } from 'vitest'
import { verifyHublaToken, parseHublaPaymentSucceeded } from './hubla'

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
})

describe('parseHublaPaymentSucceeded', () => {
  it('extracts tracking id, external event id and value', () => {
    const payload = {
      event: {
        invoice: {
          id: 'inv_123',
          amount: { totalCents: 9700 },
          firstPaymentSession: { utm: { content: 'trk_abc' } },
        },
      },
    }
    expect(parseHublaPaymentSucceeded(payload)).toEqual({
      trackingId: 'trk_abc',
      externalEventId: 'inv_123',
      valueCents: 9700,
    })
  })

  it('returns null tracking id when utm is missing', () => {
    const payload = { event: { invoice: { id: 'inv_456', amount: { totalCents: 100 } } } }
    expect(parseHublaPaymentSucceeded(payload).trackingId).toBeNull()
  })

  it('throws when invoice id is missing', () => {
    const payload = { event: { invoice: {} } }
    expect(() => parseHublaPaymentSucceeded(payload)).toThrow()
  })
})
