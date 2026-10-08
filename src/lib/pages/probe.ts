import { lookup } from 'node:dns/promises'
import { connect } from 'node:tls'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_HTML_BYTES,
  MAX_PAGES_PER_CLIENT,
  MAX_REDIRECTS,
  containsText,
  findCheckoutLink,
  hasMetaPixel,
  isPublicAddress,
  isSafeProbeUrl,
  pageTitle,
  type PageWatch,
} from '@/lib/domain/page-probe'

export type LookupAll = (hostname: string) => Promise<{ address: string }[]>
export type CertExpiry = (address: string, servername: string) => Promise<Date | null>

export interface ProbeDeps {
  fetch: typeof fetch
  lookup: LookupAll
  certExpiry: CertExpiry
}

const TIMEOUT_MS = 10_000
const KEEP_DAYS = 30

/** Reads only the certificate of an address already checked as public; nothing is sent over it. */
const readCertExpiry: CertExpiry = (address, servername) =>
  new Promise((resolve) => {
    // The expiry is read even from an invalid certificate: an expired one is exactly what to report.
    const socket = connect({ host: address, port: 443, servername, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
      const validTo = socket.getPeerCertificate()?.valid_to
      socket.destroy()
      const date = validTo ? new Date(validTo) : null
      resolve(date && !Number.isNaN(date.getTime()) ? date : null)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(null)
    })
    socket.on('error', () => resolve(null))
  })

const defaultDeps: ProbeDeps = {
  fetch: (...args) => fetch(...args),
  lookup: (hostname) => lookup(hostname, { all: true }),
  certExpiry: readCertExpiry,
}

type Hop = { ok: true; response: Response; address: string; release: () => void } | { ok: false; error: string }

/** One request, only to a public https URL whose name resolves only to public addresses. */
async function requestOnce(url: string, deps: ProbeDeps): Promise<Hop> {
  if (!isSafeProbeUrl(url)) return { ok: false, error: 'endereço não permitido' }
  // A public name pointed at 127.0.0.1 or at the cloud metadata address would otherwise turn the
  // probe into a request from inside.
  // bsheep: the fetch resolves the name again, so a name re-pointed in between (DNS rebinding) is not covered
  let addresses: { address: string }[]
  try {
    addresses = await deps.lookup(new URL(url).hostname)
  } catch {
    return { ok: false, error: 'domínio não encontrado' }
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) return { ok: false, error: 'endereço não permitido' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await deps.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'CentralDeTrafego-Sonda/1.0' },
      cache: 'no-store',
    })
    return { ok: true, response, address: addresses[0].address, release: () => clearTimeout(timer) }
  } catch (err) {
    clearTimeout(timer)
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, error: aborted ? `sem resposta em ${TIMEOUT_MS / 1000}s` : 'falha de conexão' }
  }
}

interface Landing {
  ok: boolean
  statusCode: number | null
  ttfbMs: number | null
  error: string | null
  finalUrl: string
  redirects: number
  /** The final response, still open, when `keepBody` was asked; the caller releases it. */
  hop: Extract<Hop, { ok: true }> | null
}

/**
 * Follows up to MAX_REDIRECTS hops by hand, so every hop passes the same safety checks and timeout.
 * The time is to the final response's headers: what a visitor waits for anything.
 */
async function follow(url: string, deps: ProbeDeps, keepBody: boolean): Promise<Landing> {
  const started = Date.now()
  let current = url
  for (let redirects = 0; ; redirects++) {
    const hop = await requestOnce(current, deps)
    if (!hop.ok) return { ok: false, statusCode: null, ttfbMs: null, error: hop.error, finalUrl: current, redirects, hop: null }
    const { status } = hop.response
    const location = hop.response.headers.get('location')
    if (status >= 300 && status < 400 && location) {
      await hop.response.body?.cancel()
      hop.release()
      const fail = (error: string): Landing => ({ ok: false, statusCode: status, ttfbMs: null, error, finalUrl: current, redirects, hop: null })
      if (redirects === MAX_REDIRECTS) return fail(`mais de ${MAX_REDIRECTS} redirecionamentos`)
      try {
        current = new URL(location, current).toString()
      } catch {
        return fail('redirecionamento inválido')
      }
      continue
    }
    const ok = status < 400
    const landing: Landing = { ok, statusCode: status, ttfbMs: Date.now() - started, error: ok ? null : `HTTP ${status}`, finalUrl: current, redirects, hop: null }
    if (keepBody) return { ...landing, hop }
    await hop.response.body?.cancel()
    hop.release()
    return landing
  }
}

/** The first `limit` bytes of the body as text; the rest is never downloaded. */
async function readStart(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel()
  const bytes = new Uint8Array(Math.min(size, limit))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset)
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder().decode(bytes)
}

export interface ProbeResult {
  ok: boolean
  statusCode: number | null
  ttfbMs: number | null
  error: string | null
  finalUrl: string
  redirects: number
  pixelFound: boolean | null
  checkoutUrl: string | null
  checkoutOk: boolean | null
  textFound: boolean | null
  certExpiresAt: string | null
  /** The page's <title>, read only when asked (the add form prefills the name with it). */
  title: string | null
}

/** One full check of a page: follow, read the start of the HTML for what it watches, read the certificate. */
export async function probePage(url: string, watch: PageWatch, options: { readTitle?: boolean; deps?: Partial<ProbeDeps> } = {}): Promise<ProbeResult> {
  const deps = { ...defaultDeps, ...options.deps }
  const landing = await follow(url, deps, true)
  let html: string | null = null
  if (landing.hop) {
    const wantsHtml = landing.ok && (watch.watchPixel || watch.watchCheckout || watch.requiredText || options.readTitle)
    try {
      if (wantsHtml) html = await readStart(landing.hop.response, MAX_HTML_BYTES)
      else await landing.hop.response.body?.cancel()
    } catch {
      // A body cut off mid-read leaves the content items unknown, not failed.
    } finally {
      landing.hop.release()
    }
  }
  const checkoutUrl = watch.watchCheckout && html !== null ? findCheckoutLink(html, landing.finalUrl) : null
  const checkoutOk = !watch.watchCheckout || html === null ? null : checkoutUrl ? (await follow(checkoutUrl, deps, false)).ok : false
  // bsheep: PageSpeed (mobile LCP) would go here; it is an external Google service, left out until decided
  const cert = landing.hop ? await deps.certExpiry(landing.hop.address, new URL(landing.finalUrl).hostname).catch(() => null) : null
  return {
    ok: landing.ok,
    statusCode: landing.statusCode,
    ttfbMs: landing.ttfbMs,
    error: landing.error,
    finalUrl: landing.finalUrl,
    redirects: landing.redirects,
    pixelFound: watch.watchPixel && html !== null ? hasMetaPixel(html) : null,
    checkoutUrl,
    checkoutOk,
    textFound: watch.requiredText && html !== null ? containsText(html, watch.requiredText) : null,
    certExpiresAt: cert ? cert.toISOString() : null,
    title: options.readTitle && html !== null ? pageTitle(html) : null,
  }
}

export interface PageToProbe {
  id: string
  client_id: string
  url: string
  watch_pixel: boolean
  watch_checkout: boolean
  required_text: string | null
}

export const PAGE_TO_PROBE_COLUMNS = 'id, client_id, url, watch_pixel, watch_checkout, required_text'

/** Probes the pages and records one check each. */
export async function probePages(appDb: SupabaseClient, pages: PageToProbe[], deps: Partial<ProbeDeps> = {}): Promise<number> {
  if (pages.length === 0) return 0
  const results = await Promise.all(
    pages.map(async (page) => ({
      page,
      result: await probePage(page.url, { watchPixel: page.watch_pixel, watchCheckout: page.watch_checkout, requiredText: page.required_text }, { deps }),
    }))
  )
  const { error } = await appDb.from('page_checks').insert(
    results.map(({ page, result }) => ({
      page_id: page.id,
      client_id: page.client_id,
      ok: result.ok,
      status_code: result.statusCode,
      ttfb_ms: result.ttfbMs,
      error: result.error,
      final_url: result.finalUrl,
      redirects: result.redirects,
      pixel_found: result.pixelFound,
      checkout_url: result.checkoutUrl,
      checkout_ok: result.checkoutOk,
      text_found: result.textFound,
      cert_expires_at: result.certExpiresAt,
    }))
  )
  if (error) throw error
  return results.length
}

/** Probes every active page of a client and records the answers; old checks are pruned. */
export async function probeClientPages(appDb: SupabaseClient, clientId: string, deps: Partial<ProbeDeps> = {}): Promise<number> {
  const { data: pages, error } = await appDb
    .from('pages')
    .select(PAGE_TO_PROBE_COLUMNS)
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('created_at')
    .limit(MAX_PAGES_PER_CLIENT)
  if (error) throw error
  const count = await probePages(appDb, (pages ?? []) as PageToProbe[], deps)
  if (count === 0) return 0
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()
  const { error: pruneError } = await appDb.from('page_checks').delete().eq('client_id', clientId).lt('checked_at', cutoff)
  if (pruneError) throw pruneError
  return count
}

/** The 5-minute recheck: only active pages whose last check failed, any client. */
export async function probeDownPages(appDb: SupabaseClient, deps: Partial<ProbeDeps> = {}): Promise<number> {
  const { data: now, error } = await appDb.rpc('get_pages_now')
  if (error) throw error
  const downIds = ((now ?? []) as { page_id: string; last_ok: boolean | null }[]).filter((row) => row.last_ok === false).map((row) => row.page_id)
  if (downIds.length === 0) return 0
  const { data: pages, error: pagesError } = await appDb.from('pages').select(PAGE_TO_PROBE_COLUMNS).in('id', downIds)
  if (pagesError) throw pagesError
  return probePages(appDb, (pages ?? []) as PageToProbe[], deps)
}
