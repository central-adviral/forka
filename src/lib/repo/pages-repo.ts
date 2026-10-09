import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_PAGES_PER_CLIENT, pageKey, type AbDestination, type PageCheck, type PageWatch } from '@/lib/domain/page-probe'

export interface ProbedPage {
  id: string
  label: string
  url: string
  isActive: boolean
  salesFunnelId: string | null
  /** Null is "sem frente · orgânico" (0093). */
  frontId: string | null
  watch: PageWatch
  silencedUntil: string | null
  /** Newest first. */
  checks: PageCheck[]
}

const CHECK_COLUMNS = 'checked_at, ok, ttfb_ms, status_code, error, final_url, redirects, pixel_found, checkout_url, checkout_ok, text_found, cert_expires_at'

/**
 * The client's pages with their latest checks (0066, 0089, 0093): the last `checksPerPage`, or every check
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
    .select('id, label, url, is_active, sales_funnel_id, front_id, watch_pixel, watch_checkout, required_text, silenced_until')
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
    frontId: page.front_id,
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

export interface ExistingPage {
  id: string
  label: string
  projectName: string | null
  frontName: string | null
}

/** The client's page at this address (query, hash and trailing slash ignored), if the probe has it already. */
export async function findPageByUrl(db: SupabaseClient, clientId: string, url: string, exceptId?: string): Promise<ExistingPage | null> {
  const { data, error } = await db.from('pages').select('id, label, url, project:sales_funnels(name), front:project_fronts(name)').eq('client_id', clientId)
  if (error) throw error
  const key = pageKey(url)
  const found = ((data ?? []) as unknown as { id: string; label: string; url: string; project: { name: string } | null; front: { name: string } | null }[]).find(
    (page) => page.id !== exceptId && pageKey(page.url) === key
  )
  return found ? { id: found.id, label: found.label, projectName: found.project?.name ?? null, frontName: found.front?.name ?? null } : null
}

/** Whether the probe has room for one more active page of the client (MAX_PAGES_PER_CLIENT). */
export async function hasProbeSlot(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { count, error } = await db.from('pages').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_active', true)
  if (error) throw error
  return (count ?? 0) < MAX_PAGES_PER_CLIENT
}

/** A refused page write in the screen's words. */
export function pageWriteError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Essa página já está na sonda.'
  if (error.code === '42501') return 'Só gestor ou owner pode cadastrar páginas.'
  if (error.code === '23503') return 'Esse funil não é deste cliente.'
  if (error.code === '23514') return 'Escolha uma frente do próprio funil que tenha campanhas.'
  return error.message
}
