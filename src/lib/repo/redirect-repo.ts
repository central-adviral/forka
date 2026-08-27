import type { SupabaseClient } from '@supabase/supabase-js'

export interface VariantRow {
  id: string
  name: string
  weight_pct: number
  destination_url: string
}

export interface TestWithVariants {
  id: string
  slug: string
  status: 'active' | 'paused'
  fallback_url: string | null
  variants: VariantRow[]
}

export async function getTestBySlug(db: SupabaseClient, slug: string): Promise<TestWithVariants | null> {
  const { data, error } = await db
    .from('tests')
    .select('id, slug, status, fallback_url, variants(id, name, weight_pct, destination_url)')
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
