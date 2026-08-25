import { timingSafeEqual } from 'node:crypto'

export function verifyHublaToken(received: string | null, expected: string): boolean {
  if (!received) return false
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

export function parseHublaPaymentSucceeded(payload: any): ParsedHublaEvent {
  const invoice = payload?.event?.invoice
  if (!invoice?.id) {
    throw new Error('Hubla payload missing event.invoice.id')
  }
  return {
    trackingId: invoice.firstPaymentSession?.utm?.content ?? null,
    externalEventId: invoice.id,
    valueCents: invoice.amount?.totalCents ?? null,
  }
}
