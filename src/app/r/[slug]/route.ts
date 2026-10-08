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
import { TRACKED_URL_PARAMS } from '@/lib/domain/campaign-link'

const COOKIE_MAX_AGE_DAYS = Number(process.env.COOKIE_MAX_AGE_DAYS ?? '30')
const MAX_CLICKS_PER_IP_PER_HOUR = 30

// Both branches below capture through this, so neither can drift from the template again. The last
// time they each held their own copy, the human one omitted utm_content and every real visitor's
// click threw the adset name away while the bot's kept it.
function captureTrackedParams(searchParams: URLSearchParams): Record<string, string> {
  return Object.fromEntries(TRACKED_URL_PARAMS.map((key) => [key, searchParams.get(key) ?? '']))
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip')
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createServiceRoleClient()
  const test = await getTestBySlug(db, slug)

  if (!test || test.variants.length === 0) {
    if (test?.fallback_url) return NextResponse.redirect(withUtms(test.fallback_url, captureTrackedParams(request.nextUrl.searchParams)), 302)
    return new NextResponse('Not found', { status: 404 })
  }

  // Bots and paused tests both land on the real control, never on whichever variant sorts first by
  // name: Meta's reviewer must see the page people see, and a paused test's ads still pay for clicks.
  const control = test.variants.find((v) => v.is_control) ?? test.variants[0]
  const controlDestination = resolveEntryDestination({
    testType: test.test_type,
    salesPageUrl: test.sales_page_url,
    variantDestinationUrl: control.destination_url,
  })

  if (test.status !== 'active') {
    return NextResponse.redirect(withUtms(test.fallback_url ?? controlDestination, captureTrackedParams(request.nextUrl.searchParams)), 302)
  }

  if (isKnownBot(request.headers.get('user-agent'))) {
    const botSourceUtms = captureTrackedParams(request.nextUrl.searchParams)
    after(async () => {
      try {
        await insertClickEvent(db, {
          testId: test.id,
          variantId: control.id,
          visitorId: crypto.randomUUID(),
          trackingId: crypto.randomUUID(),
          sourceUtms: botSourceUtms,
          ip: getClientIp(request),
          userAgent: request.headers.get('user-agent'),
          isBot: true,
        })
      } catch (err) {
        console.error('[click-insert-failed]', { testId: test.id, slug, isBot: true }, err)
      }
    })
    return NextResponse.redirect(controlDestination, 302)
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

  const sourceUtms = captureTrackedParams(request.nextUrl.searchParams)

  const ip = getClientIp(request)
  after(async () => {
    try {
      const recentClicksFromIp = ip ? await countRecentClickEventsByIp(db, { testId: test.id, ip, sinceMinutes: 60 }) : 0
      if (!ip || recentClicksFromIp < MAX_CLICKS_PER_IP_PER_HOUR) {
        await insertClickEvent(db, {
          testId: test.id,
          variantId: variant.id,
          visitorId,
          trackingId,
          sourceUtms,
          ip,
        })
      } else {
        console.log('[click-rate-limited]', { testId: test.id, slug, ip, visitorId, recentClicksFromIp })
      }
    } catch (err) {
      console.error('[click-insert-failed]', { testId: test.id, slug, isBot: false }, err)
    }
  })

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
