import type { SupabaseClient } from '@supabase/supabase-js'

export interface VariantRow {
  id: string
  name: string
  weight_pct: number
  destination_url: string
  is_control: boolean
}

export interface TestWithVariants {
  id: string
  slug: string
  status: 'active' | 'paused'
  fallback_url: string | null
  test_type: 'page' | 'checkout'
  sales_page_url: string | null
  variants: VariantRow[]
}

export async function getTestBySlug(db: SupabaseClient, slug: string): Promise<TestWithVariants | null> {
  const { data, error } = await db
    .from('tests')
    .select(
      'id, slug, status, fallback_url, test_type, sales_page_url, variants(id, name, weight_pct, destination_url, is_control)'
    )
    .eq('slug', slug)
    .order('name', { referencedTable: 'variants' })
    .maybeSingle()

  if (error) throw error
  return data as TestWithVariants | null
}

export async function insertClickEvent(
  db: SupabaseClient,
  params: {
    testId: string
    variantId: string
    visitorId: string
    trackingId: string
    sourceUtms: Record<string, string>
    ip?: string | null
    userAgent?: string | null
    isBot?: boolean
    rateLimited?: boolean
  }
): Promise<void> {
  const { error } = await db.from('click_events').insert({
    test_id: params.testId,
    variant_id: params.variantId,
    visitor_id: params.visitorId,
    tracking_id: params.trackingId,
    source_utms: params.sourceUtms,
    ip: params.ip ?? null,
    user_agent: params.userAgent ?? null,
    is_bot: params.isBot ?? false,
    rate_limited: params.rateLimited ?? false,
  })
  if (error) throw error
}

export async function countRecentClickEventsByIp(
  db: SupabaseClient,
  params: { testId: string; ip: string; sinceMinutes: number }
): Promise<number> {
  const since = new Date(Date.now() - params.sinceMinutes * 60 * 1000).toISOString()
  const { count, error } = await db
    .from('click_events')
    .select('id', { count: 'exact', head: true })
    .eq('test_id', params.testId)
    .eq('ip', params.ip)
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}

// The click IP only feeds the one-hour rate limit above; past 30 days it is personal data with no use.
export const CLICK_IP_RETENTION_DAYS = 30

export async function purgeOldClickIps(db: SupabaseClient, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - CLICK_IP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await db.from('click_events').update({ ip: null }).not('ip', 'is', null).lt('created_at', cutoff)
  if (error) throw error
}

export async function getOrAssignVariant(
  db: SupabaseClient,
  params: { testId: string; visitorId: string; candidateVariantId: string }
): Promise<string> {
  const { data, error } = await db.rpc('get_or_assign_variant', {
    p_test_id: params.testId,
    p_visitor_id: params.visitorId,
    p_candidate_variant_id: params.candidateVariantId,
  })
  if (error) throw error
  return data as string
}

export async function getAssignedVariantId(
  db: SupabaseClient,
  params: { testId: string; visitorId: string }
): Promise<string | null> {
  const { data, error } = await db
    .from('variant_assignments')
    .select('variant_id')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .maybeSingle()
  if (error) throw error
  return (data?.variant_id as string | undefined) ?? null
}

export interface LatestClick {
  trackingId: string
  sourceUtms: Record<string, string>
}

export async function getLatestTrackingId(
  db: SupabaseClient,
  params: { testId: string; visitorId: string }
): Promise<LatestClick | null> {
  const { data, error } = await db
    .from('click_events')
    .select('tracking_id, source_utms')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.tracking_id) return null
  return {
    trackingId: data.tracking_id as string,
    sourceUtms: (data.source_utms as Record<string, string> | null) ?? {},
  }
}
