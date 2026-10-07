import { lookup } from 'node:dns/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_PAGES_PER_CLIENT, isPublicAddress, isSafeProbeUrl } from '@/lib/domain/page-probe'

export type LookupAll = (hostname: string) => Promise<{ address: string }[]>

const lookupAll: LookupAll = (hostname) => lookup(hostname, { all: true })

const TIMEOUT_MS = 10_000
const KEEP_DAYS = 30

export interface ProbeResult {
  ok: boolean
  statusCode: number | null
  ttfbMs: number | null
  error: string | null
}

/**
 * One request to a page, timed to its response headers. Redirects are not followed: a 3xx is the
 * page answering (and following could carry the probe to a private address). The body is never read.
 */
export async function probeUrl(url: string, fetchImpl: typeof fetch = fetch, lookupImpl: LookupAll = lookupAll): Promise<ProbeResult> {
  if (!isSafeProbeUrl(url)) return { ok: false, statusCode: null, ttfbMs: null, error: 'endereço não permitido' }
  // Every address the name resolves to must be public: a public name pointed at 127.0.0.1 or at
  // the cloud metadata address would otherwise turn the probe into a request from inside.
  // bsheep: the fetch resolves the name again, so a name re-pointed in between (DNS rebinding) is not covered
  let addresses: { address: string }[]
  try {
    addresses = await lookupImpl(new URL(url).hostname)
  } catch {
    return { ok: false, statusCode: null, ttfbMs: null, error: 'domínio não encontrado' }
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
    return { ok: false, statusCode: null, ttfbMs: null, error: 'endereço não permitido' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'CentralDeTrafego-Sonda/1.0' },
      cache: 'no-store',
    })
    const ttfbMs = Date.now() - started
    await response.body?.cancel()
    return { ok: response.status < 400, statusCode: response.status, ttfbMs, error: response.status < 400 ? null : `HTTP ${response.status}` }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, statusCode: null, ttfbMs: null, error: aborted ? `sem resposta em ${TIMEOUT_MS / 1000}s` : 'falha de conexão' }
  } finally {
    clearTimeout(timer)
  }
}

/** Probes every active page of a client and records the answers; old checks are pruned. */
export async function probeClientPages(
  appDb: SupabaseClient,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl: LookupAll = lookupAll
): Promise<number> {
  const { data: pages, error } = await appDb
    .from('pages')
    .select('id, url')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('created_at')
    .limit(MAX_PAGES_PER_CLIENT)
  if (error) throw error
  if (!pages?.length) return 0
  const results = await Promise.all(pages.map(async (page) => ({ page, result: await probeUrl(page.url as string, fetchImpl, lookupImpl) })))
  const { error: insertError } = await appDb.from('page_checks').insert(
    results.map(({ page, result }) => ({
      page_id: page.id,
      client_id: clientId,
      ok: result.ok,
      status_code: result.statusCode,
      ttfb_ms: result.ttfbMs,
      error: result.error,
    }))
  )
  if (insertError) throw insertError
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()
  const { error: pruneError } = await appDb.from('page_checks').delete().eq('client_id', clientId).lt('checked_at', cutoff)
  if (pruneError) throw pruneError
  return results.length
}
