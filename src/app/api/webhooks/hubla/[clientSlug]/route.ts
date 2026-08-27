import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { HublaIrrelevantEventError, verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

export async function POST(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const db = createServiceRoleClient()

  const { data: client } = await db
    .from('clients')
    .select('id, hubla_webhook_token')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client || !client.hubla_webhook_token) {
    return new NextResponse('Not found', { status: 404 })
  }

  const receivedToken = request.headers.get('x-hubla-token')
  if (!verifyHublaToken(receivedToken, client.hubla_webhook_token)) {
    console.error(`[hubla-webhook] rejected: invalid or missing x-hubla-token for client ${clientSlug}`)
    return new NextResponse('Invalid token', { status: 401 })
  }

  if (request.headers.get('x-hubla-sandbox') === 'true') {
    return NextResponse.json({ ok: true, attributed: false })
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

  const clickEvent = await getClickEventByTrackingId(db, parsed.trackingId)
  if (!clickEvent || clickEvent.clientId !== client.id) {
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
