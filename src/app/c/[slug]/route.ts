import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  getAssignedVariantId,
  getLatestFunnelClick,
  getLatestTrackingId,
  getOrAssignVariant,
  getTestBySlug,
  insertClickEvent,
  type TestWithVariants,
} from '@/lib/repo/redirect-repo'
import { VISITOR_COOKIE, assignmentCookieName, getOrCreateVisitorId, readAssignedVariantId } from '@/lib/domain/cookie-assignment'
import { withTrackingId, withUtms } from '@/lib/domain/test-destination'
import { pickVariant } from '@/lib/domain/pick-variant'
import { isKnownBot } from '@/lib/domain/bot-filter'

const COOKIE_MAX_AGE_DAYS = Number(process.env.COOKIE_MAX_AGE_DAYS ?? '30')

/**
 * Layers (0078): a visitor who reached the buy button through the project's page test never passed
 * this test's /r. An active test enters them here, drawn by weight like /r does, with the page click
 * as parent and its utms; a paused one sends them to the control carrying the page click, so the
 * sale still has an owner.
 */
async function enterFromProject(request: NextRequest, test: TestWithVariants & { sales_funnel_id: string }, visitorCookie: string | undefined) {
  const db = createServiceRoleClient()
  const control = test.variants.find((v) => v.is_control) ?? test.variants[0]
  const { visitorId } = getOrCreateVisitorId(visitorCookie)
  const parent = visitorCookie ? await getLatestFunnelClick(db, { salesFunnelId: test.sales_funnel_id, visitorId: visitorCookie }) : null
  const sourceUtms = parent?.sourceUtms ?? {}

  if (test.status !== 'active' || isKnownBot(request.headers.get('user-agent'))) {
    return NextResponse.redirect(withTrackingId(withUtms(control.destination_url, sourceUtms), parent?.trackingId ?? null), 302)
  }

  const candidateId = pickVariant(test.variants.map((v) => ({ id: v.id, weightPct: v.weight_pct })))
  const assignedId = await getOrAssignVariant(db, { testId: test.id, visitorId, candidateVariantId: candidateId })
  const variant = test.variants.find((v) => v.id === assignedId) ?? control
  const trackingId = crypto.randomUUID()
  after(async () => {
    try {
      await insertClickEvent(db, { testId: test.id, variantId: variant.id, visitorId, trackingId, sourceUtms, parentTrackingId: parent?.trackingId ?? null })
    } catch (err) {
      console.error('[checkout-entry-insert-failed]', { testId: test.id, slug: test.slug }, err)
    }
  })

  const response = NextResponse.redirect(withTrackingId(withUtms(variant.destination_url, sourceUtms), trackingId), 302)
  response.cookies.set(VISITOR_COOKIE, visitorId, { maxAge: 60 * 60 * 24 * 365, httpOnly: true, secure: true, sameSite: 'lax' })
  response.cookies.set(assignmentCookieName(test.slug), variant.id, { maxAge: 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS, httpOnly: true, secure: true, sameSite: 'lax' })
  return response
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createServiceRoleClient()
  const test = await getTestBySlug(db, slug)

  // tests.status is deliberately not checked: pausing a test must never break a
  // buy button that is live on the client's sales page.
  if (!test || test.test_type !== 'checkout' || test.variants.length === 0) {
    return new NextResponse('Not found', { status: 404 })
  }

  const cookies = Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value]))
  const visitorId = cookies[VISITOR_COOKIE]

  const cookieVariantId = readAssignedVariantId(cookies, test.slug)
  let variant = test.variants.find((v) => v.id === cookieVariantId)

  if (!variant && visitorId) {
    const assignedId = await getAssignedVariantId(db, { testId: test.id, visitorId })
    variant = test.variants.find((v) => v.id === assignedId)
  }

  const isKnownVisitor = Boolean(variant)
  if (!isKnownVisitor && test.sales_funnel_id) {
    return enterFromProject(request, { ...test, sales_funnel_id: test.sales_funnel_id }, visitorId)
  }
  const resolved = variant ?? test.variants.find((v) => v.is_control) ?? test.variants[0]

  const latestClick =
    isKnownVisitor && visitorId ? await getLatestTrackingId(db, { testId: test.id, visitorId }) : null

  if (isKnownVisitor && !latestClick) {
    console.log('[checkout-golink-no-click]', { testId: test.id, slug, variantId: resolved.id, visitorId })
  } else if (!isKnownVisitor) {
    console.log('[checkout-golink-unknown-visitor]', {
      testId: test.id,
      slug,
      variantId: resolved.id,
      visitorId: visitorId ?? null,
    })
  }

  const destination = withTrackingId(
    withUtms(resolved.destination_url, latestClick?.sourceUtms ?? {}),
    latestClick?.trackingId ?? null
  )

  return NextResponse.redirect(destination, 302)
}
