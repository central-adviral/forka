import type { SupabaseClient } from '@supabase/supabase-js'
import type { PageCheck } from '@/lib/domain/page-probe'

export interface ProbedPage {
  id: string
  label: string
  url: string
  isActive: boolean
  /** Newest first. */
  checks: PageCheck[]
}

/** The client's pages with their latest checks (0066). */
export async function getPagesWithChecks(db: SupabaseClient, clientId: string, checksPerPage = 12): Promise<ProbedPage[]> {
  const { data: pages, error } = await db.from('pages').select('id, label, url, is_active').eq('client_id', clientId).order('created_at')
  if (error) throw error
  if (!pages?.length) return []
  const { data: checks, error: checksError } = await db
    .from('page_checks')
    .select('page_id, checked_at, ok, ttfb_ms, status_code, error')
    .eq('client_id', clientId)
    .order('checked_at', { ascending: false })
    .limit(pages.length * checksPerPage)
  if (checksError) throw checksError
  return pages.map((page) => ({
    id: page.id,
    label: page.label,
    url: page.url,
    isActive: page.is_active,
    checks: (checks ?? [])
      .filter((check) => check.page_id === page.id)
      .slice(0, checksPerPage)
      .map((check) => ({ ok: check.ok, ttfbMs: check.ttfb_ms, statusCode: check.status_code, error: check.error, checkedAt: check.checked_at })),
  }))
}
