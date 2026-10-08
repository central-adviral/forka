import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7', 'base64')

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const trackingId = request.nextUrl.searchParams.get('tid')

  if (trackingId) {
    const db = createServiceRoleClient()
    const clickEvent = await getClickEventByTrackingId(db, trackingId)
    // A bot's click is not a person: its "lead" would inflate the variant it was sent to.
    if (clickEvent && clickEvent.testSlug === slug && !clickEvent.isBot) {
      await insertConversionIfNew(db, { clickEventId: clickEvent.id, source: 'thank_you_page' })
    }
  }

  return new NextResponse(TRANSPARENT_GIF, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
  })
}
