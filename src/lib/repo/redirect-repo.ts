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
  }
): Promise<void> {
  const { error } = await db.from('click_events').insert({
    test_id: params.testId,
    variant_id: params.variantId,
    visitor_id: params.visitorId,
    tracking_id: params.trackingId,
    source_utms: params.sourceUtms,
  })
  if (error) throw error
}
