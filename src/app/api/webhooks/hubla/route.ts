import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { HublaIrrelevantEventError, verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

export async function POST(request: NextRequest) {
  const receivedToken = request.headers.get('x-hubla-token')
  if (!verifyHublaToken(receivedToken, process.env.HUBLA_WEBHOOK_TOKEN)) {
    console.error('[hubla-webhook] rejected: invalid or missing x-hubla-token')
    return new NextResponse('Invalid token', { status: 401 })
  }

  let parsed
  try {
    const payload = await request.json()
    parsed = parseHublaPaymentSucceeded(payload)
  } catch (err) {
    if (err instanceof HublaIrrelevantEventError) {
      return NextResponse.json({ ok: true, attributed: false })
    }
    console.error('[hubla-webhook] rejected malformed payload', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, attributed: false }, { status: 422 })
  }

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
