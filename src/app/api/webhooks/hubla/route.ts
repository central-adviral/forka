import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

export async function POST(request: NextRequest) {
  const receivedToken = request.headers.get('x-hubla-token')
  if (!verifyHublaToken(receivedToken, process.env.HUBLA_WEBHOOK_TOKEN!)) {
    return new NextResponse('Invalid token', { status: 401 })
  }

  const payload = await request.json()
  const parsed = parseHublaPaymentSucceeded(payload)

  if (!parsed.trackingId) {
    return NextResponse.json({ ok: true, attributed: false })
  }

  const db = createServiceRoleClient()
  const clickEvent = await getClickEventByTrackingId(db, parsed.trackingId)
  if (!clickEvent) {
    return NextResponse.json({ ok: true, attributed: false })
  }

  const result = await insertConversionIfNew(db, {
    clickEventId: clickEvent.id,
    source: 'hubla_webhook',
    externalEventId: parsed.externalEventId,
    valueCents: parsed.valueCents,
  })

  return NextResponse.json({ ok: true, attributed: true, result })
}
