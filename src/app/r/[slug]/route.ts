import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getTestBySlug, insertClickEvent } from '@/lib/repo/redirect-repo'
import { pickVariant } from '@/lib/domain/pick-variant'
import { isKnownBot } from '@/lib/domain/bot-filter'
import {
  VISITOR_COOKIE,
  assignmentCookieName,
  getOrCreateVisitorId,
  readAssignedVariantId,
} from '@/lib/domain/cookie-assignment'

const COOKIE_MAX_AGE_DAYS = Number(process.env.COOKIE_MAX_AGE_DAYS ?? '30')

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createServiceRoleClient()
  const test = await getTestBySlug(db, slug)

  if (!test || test.status !== 'active' || test.variants.length === 0) {
    if (test?.fallback_url) {
      return NextResponse.redirect(test.fallback_url, 302)
    }
    return new NextResponse('Not found', { status: 404 })
  }

  if (isKnownBot(request.headers.get('user-agent'))) {
    const destination = test.fallback_url ?? test.variants[0].destination_url
    return NextResponse.redirect(destination, 302)
  }

  const cookieHeader = Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value]))
  const assignedVariantId = readAssignedVariantId(cookieHeader, test.slug)
  const chosenId =
    test.variants.find((v) => v.id === assignedVariantId)?.id ??
    pickVariant(test.variants.map((v) => ({ id: v.id, weightPct: v.weight_pct })))
  const variant = test.variants.find((v) => v.id === chosenId)!

  const { visitorId } = getOrCreateVisitorId(cookieHeader[VISITOR_COOKIE])
  const trackingId = crypto.randomUUID()

  const sourceUtms = Object.fromEntries(
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].map((key) => [
      key,
      request.nextUrl.searchParams.get(key) ?? '',
    ])
  )

  await insertClickEvent(db, {
    testId: test.id,
    variantId: variant.id,
    visitorId,
    trackingId,
    sourceUtms,
  })

  const destination = new URL(variant.destination_url)
  destination.searchParams.set('utm_content', trackingId)

  const response = NextResponse.redirect(destination, 302)
  response.cookies.set(VISITOR_COOKIE, visitorId, { maxAge: 60 * 60 * 24 * 365, httpOnly: true })
  response.cookies.set(assignmentCookieName(test.slug), variant.id, {
    maxAge: 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS,
    httpOnly: true,
  })
  return response
}
