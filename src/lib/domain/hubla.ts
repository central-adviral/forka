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
