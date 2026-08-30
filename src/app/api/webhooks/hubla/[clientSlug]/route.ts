import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { HublaIrrelevantEventError, verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

// Hubla's payload can carry customer PII (name/email/phone) alongside the invoice/UTM data we
// actually need to debug attribution. Redact known PII field names before this ever reaches logs.
const PII_KEYS = new Set([
  'email',
  'phone',
  'phoneNumber',
  'name',
  'firstName',
  'lastName',
  'document',
  'cpf',
  'cnpj',
  'address',
  'payer',
  'user',
  'customer',
  'billingAddress',
])

function redactPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPii)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = PII_KEYS.has(key) ? '[redacted]' : redactPii(val)
    }
    return out
  }
  return value
}

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

  let payload: unknown
  try {
    payload = await request.json()
  } catch (err) {
    console.error('[hubla-webhook] rejected: could not parse JSON body', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, attributed: false }, { status: 422 })
  }

  let parsed
  try {
    parsed = parseHublaPaymentSucceeded(payload)
  } catch (err) {
    if (err instanceof HublaIrrelevantEventError) {
      console.log('[hubla-webhook] irrelevant event, raw payload:', JSON.stringify(redactPii(payload)))
      return NextResponse.json({ ok: true, attributed: false })
    }
    console.error(
      '[hubla-webhook] rejected malformed payload',
      err instanceof Error ? err.message : String(err),
      'raw payload:',
      JSON.stringify(redactPii(payload))
    )
    return NextResponse.json({ ok: false, attributed: false }, { status: 422 })
  }

  if (!parsed.trackingId) {
    console.log('[hubla-webhook] no trackingId extracted from payload, raw payload:', JSON.stringify(redactPii(payload)))
    return NextResponse.json({ ok: true, attributed: false })
  }

  const clickEvent = await getClickEventByTrackingId(db, parsed.trackingId)
  if (!clickEvent || clickEvent.clientId !== client.id) {
    console.log('[hubla-webhook] trackingId did not match a click event for this client', {
      trackingId: parsed.trackingId,
      foundClickEvent: Boolean(clickEvent),
    })
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
