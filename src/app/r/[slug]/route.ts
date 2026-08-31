import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { countRecentClickEventsByIp, getOrAssignVariant, getTestBySlug, insertClickEvent } from '@/lib/repo/redirect-repo'
import { pickVariant } from '@/lib/domain/pick-variant'
import { isKnownBot } from '@/lib/domain/bot-filter'
import {
  VISITOR_COOKIE,
  assignmentCookieName,
  getOrCreateVisitorId,
  readAssignedVariantId,
} from '@/lib/domain/cookie-assignment'
import { resolveEntryDestination, withTrackingId, withUtms } from '@/lib/domain/test-destination'

const COOKIE_MAX_AGE_DAYS = Number(process.env.COOKIE_MAX_AGE_DAYS ?? '30')
const MAX_CLICKS_PER_IP_PER_HOUR = 30

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip')
}

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
    const botSourceUtms = Object.fromEntries(
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].map((key) => [
        key,
        request.nextUrl.searchParams.get(key) ?? '',
      ])
    )
    after(async () => {
      try {
        await insertClickEvent(db, {
          testId: test.id,
          variantId: test.variants[0].id,
          visitorId: crypto.randomUUID(),
          trackingId: crypto.randomUUID(),
          sourceUtms: botSourceUtms,
          ip: getClientIp(request),
          isBot: true,
        })
      } catch (err) {
        console.error('[click-insert-failed]', { testId: test.id, slug, isBot: true }, err)
      }
    })
    const destination =
      test.fallback_url ??
      resolveEntryDestination({
        testType: test.test_type,
        salesPageUrl: test.sales_page_url,
        variantDestinationUrl: test.variants[0].destination_url,
      })
    return NextResponse.redirect(destination, 302)
  }

  const cookieHeader = Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value]))
  const { visitorId } = getOrCreateVisitorId(cookieHeader[VISITOR_COOKIE])
  const assignedVariantId = readAssignedVariantId(cookieHeader, test.slug)

  let variant = test.variants.find((v) => v.id === assignedVariantId)
  if (!variant) {
    const candidateId = pickVariant(test.variants.map((v) => ({ id: v.id, weightPct: v.weight_pct })))
    const resolvedVariantId = await getOrAssignVariant(db, {
      testId: test.id,
      visitorId,
      candidateVariantId: candidateId,
    })
    variant = test.variants.find((v) => v.id === resolvedVariantId)!
  }

  const trackingId = crypto.randomUUID()

  const sourceUtms = Object.fromEntries(
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].map((key) => [
      key,
      request.nextUrl.searchParams.get(key) ?? '',
    ])
  )

  const ip = getClientIp(request)
  const recentClicksFromIp = ip ? await countRecentClickEventsByIp(db, { testId: test.id, ip, sinceMinutes: 60 }) : 0
  if (!ip || recentClicksFromIp < MAX_CLICKS_PER_IP_PER_HOUR) {
    after(async () => {
      try {
        await insertClickEvent(db, {
          testId: test.id,
          variantId: variant.id,
          visitorId,
          trackingId,
          sourceUtms,
          ip,
        })
      } catch (err) {
        console.error('[click-insert-failed]', { testId: test.id, slug, isBot: false }, err)
      }
    })
  } else {
    console.log('[click-rate-limited]', { testId: test.id, slug, ip, visitorId, recentClicksFromIp })
  }

  const destination = withTrackingId(
    withUtms(
      resolveEntryDestination({
        testType: test.test_type,
        salesPageUrl: test.sales_page_url,
        variantDestinationUrl: variant.destination_url,
      }),
      sourceUtms
    ),
    trackingId
  )

  const response = NextResponse.redirect(destination, 302)
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  })
  response.cookies.set(assignmentCookieName(test.slug), variant.id, {
    maxAge: 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  })
  return response
}
