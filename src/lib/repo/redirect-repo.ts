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
  }
): Promise<void> {
  const { error } = await db.from('click_events').insert({
    test_id: params.testId,
    variant_id: params.variantId,
    visitor_id: params.visitorId,
    tracking_id: params.trackingId,
    source_utms: params.sourceUtms,
    ip: params.ip ?? null,
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

export async function getOrAssignVariant(
  db: SupabaseClient,
  params: { testId: string; visitorId: string; candidateVariantId: string }
): Promise<string> {
  await db
    .from('variant_assignments')
    .upsert(
      { test_id: params.testId, visitor_id: params.visitorId, variant_id: params.candidateVariantId },
      { onConflict: 'test_id,visitor_id', ignoreDuplicates: true }
    )

  const { data, error } = await db
    .from('variant_assignments')
    .select('variant_id')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .single()
  if (error) throw error
  return data.variant_id as string
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

export async function getLatestTrackingId(
  db: SupabaseClient,
  params: { testId: string; visitorId: string }
): Promise<string | null> {
  const { data, error } = await db
    .from('click_events')
    .select('tracking_id')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.tracking_id as string | undefined) ?? null
}
