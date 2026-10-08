import type { SupabaseClient } from '@supabase/supabase-js'
import type { AbDestination, PageCheck, PageWatch } from '@/lib/domain/page-probe'

export interface ProbedPage {
  id: string
  label: string
  url: string
  isActive: boolean
  salesFunnelId: string | null
  watch: PageWatch
  silencedUntil: string | null
  /** Newest first. */
  checks: PageCheck[]
}

const CHECK_COLUMNS = 'checked_at, ok, ttfb_ms, status_code, error, final_url, redirects, pixel_found, checkout_url, checkout_ok, text_found, cert_expires_at'

/**
 * The client's pages with their latest checks (0066, 0089): the last `checksPerPage`, or every check
 * of the last `sinceDays` days. One read per page, so a page rechecked every 5 minutes while down
 * never crowds out the others.
 */
export async function getPagesWithChecks(
  db: SupabaseClient,
  clientId: string,
  options: { checksPerPage?: number; sinceDays?: number } = {}
): Promise<ProbedPage[]> {
  const { data: pages, error } = await db
    .from('pages')
    .select('id, label, url, is_active, sales_funnel_id, watch_pixel, watch_checkout, required_text, silenced_until')
    .eq('client_id', clientId)
    .order('created_at')
  if (error) throw error
  if (!pages?.length) return []
  const since = options.sinceDays ? new Date(Date.now() - options.sinceDays * 86_400_000).toISOString() : null
  const checks = await Promise.all(
    pages.map(async (page) => {
      let query = db.from('page_checks').select(CHECK_COLUMNS).eq('page_id', page.id).order('checked_at', { ascending: false })
      if (since) query = query.gte('checked_at', since)
      const { data, error: checksError } = await query.limit(options.checksPerPage ?? 1000)
      if (checksError) throw checksError
      return (data ?? []).map(
        (check): PageCheck => ({
          ok: check.ok,
          ttfbMs: check.ttfb_ms,
          statusCode: check.status_code,
          error: check.error,
          checkedAt: check.checked_at,
          finalUrl: check.final_url,
          redirects: check.redirects ?? 0,
          pixelFound: check.pixel_found,
          checkoutUrl: check.checkout_url,
          checkoutOk: check.checkout_ok,
          textFound: check.text_found,
          certExpiresAt: check.cert_expires_at,
        })
      )
    })
  )
  return pages.map((page, index) => ({
    id: page.id,
    label: page.label,
    url: page.url,
    isActive: page.is_active,
    salesFunnelId: page.sales_funnel_id,
    watch: { watchPixel: page.watch_pixel, watchCheckout: page.watch_checkout, requiredText: page.required_text },
    silencedUntil: page.silenced_until,
    checks: checks[index],
  }))
}

/** Where the client's A/B tests send people: each variant's page and each routing rule's page (0084). */
export async function getAbDestinations(db: SupabaseClient, clientId: string): Promise<AbDestination[]> {
  const { data, error } = await db
    .from('tests')
    .select('name, status, variants(name, destination_url, variant_routes(destination_url))')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as {
    name: string
    status: string
    variants: { name: string; destination_url: string; variant_routes: { destination_url: string }[] }[]
  }[]).flatMap((test) =>
    test.variants.flatMap((variant) =>
      [variant.destination_url, ...variant.variant_routes.map((route) => route.destination_url)].map((url) => ({
        testName: test.name,
        testActive: test.status === 'active',
        variantName: variant.name,
        url,
      }))
    )
  )
}
