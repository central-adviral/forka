import { timingSafeEqual } from 'node:crypto'

export function verifyHublaToken(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(receivedBuf, expectedBuf)
}

export interface ParsedHublaEvent {
  trackingId: string | null
  externalEventId: string
  valueCents: number | null
}

export class HublaIrrelevantEventError extends Error {}
export class HublaMalformedPayloadError extends Error {}

interface HublaPayload {
  type?: string
  event?: {
    invoice?: {
      id?: string
      statusAt?: { status?: string; when?: string }[]
      modifiedAt?: string
      // Confirmed against a real production payload (delivery mode "compatibility") on
      // 2026-08-30: the field is `paymentSession`, not `firstPaymentSession` as earlier
      // documentation suggested. Keep the old name as a fallback in case another delivery
      // mode ever uses it — cost of being wrong here is silent attribution loss.
      paymentSession?: { utm?: { content?: string } }
      firstPaymentSession?: { utm?: { content?: string } }
      amount?: { totalCents?: number }
    }
  }
}

export function parseHublaPaymentSucceeded(rawPayload: unknown): ParsedHublaEvent {
  const payload = rawPayload as HublaPayload
  if (payload?.type !== 'invoice.payment_succeeded') {
    throw new HublaIrrelevantEventError(`Hubla payload is not a payment_succeeded event: ${payload?.type}`)
  }
  const invoice = payload?.event?.invoice
  if (!invoice?.id) {
    throw new HublaMalformedPayloadError('Hubla payload missing event.invoice.id')
  }
  return {
    trackingId: invoice.paymentSession?.utm?.content ?? invoice.firstPaymentSession?.utm?.content ?? null,
    externalEventId: invoice.id,
    valueCents: invoice.amount?.totalCents ?? null,
  }
}

export interface ParsedHublaRefund {
  externalEventId: string
  refundedAt: string
}

/**
 * A refund (`invoice.refunded`, v2 webhooks). It names the same invoice as the payment it undoes,
 * so the conversion is found by its invoice id. Hubla sends no separate chargeback event: a
 * chargeback reaches the webhook as a refund of the invoice.
 */
export function parseHublaRefund(rawPayload: unknown): ParsedHublaRefund | null {
  const payload = rawPayload as HublaPayload
  if (payload?.type !== 'invoice.refunded') return null
  const invoice = payload.event?.invoice
  if (!invoice?.id) throw new HublaMalformedPayloadError('Hubla refund payload missing event.invoice.id')
  const refunded = (invoice.statusAt ?? []).filter((entry) => entry.status === 'refunded').at(-1)?.when
  return { externalEventId: invoice.id, refundedAt: refunded ?? invoice.modifiedAt ?? new Date().toISOString() }
}

