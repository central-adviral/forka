import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getAssignedVariantId, getLatestTrackingId, getTestBySlug } from '@/lib/repo/redirect-repo'
import { VISITOR_COOKIE, readAssignedVariantId } from '@/lib/domain/cookie-assignment'
import { withTrackingId } from '@/lib/domain/test-destination'

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
  const resolved = variant ?? test.variants.find((v) => v.is_control) ?? test.variants[0]

  const trackingId =
    isKnownVisitor && visitorId ? await getLatestTrackingId(db, { testId: test.id, visitorId }) : null

  return NextResponse.redirect(withTrackingId(resolved.destination_url, trackingId), 302)
}
