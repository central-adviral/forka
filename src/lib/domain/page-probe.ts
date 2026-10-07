// What the page probe decides, kept apart from the network so it can be tested.

/** A response slower than this to its headers is "lenta": the ad click waits that long for anything. */
export const PAGE_SLOW_MS = 3000

export type PageHealth = 'ok' | 'lenta' | 'fora' | 'sem_check'

export interface PageCheck {
  ok: boolean
  ttfbMs: number | null
  statusCode: number | null
  error: string | null
  checkedAt: string
}

/**
 * The server requests whatever URL a gestor types, so only public https pages are probed: no IP
 * literals and no local or internal names. Redirects are not followed (see probe.ts), so a public
 * page cannot bounce the probe somewhere private either.
 */
export function isSafeProbeUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || host === 'localhost' || /\.(local|localhost|internal|lan|home|test)$/.test(host)) return false
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return false
  return true
}

/** Health from the newest checks first: down when the last one failed, slow when it took too long. */
export function pageHealth(checks: PageCheck[]): PageHealth {
  const last = checks[0]
  if (!last) return 'sem_check'
  if (!last.ok) return 'fora'
  if (last.ttfbMs !== null && last.ttfbMs > PAGE_SLOW_MS) return 'lenta'
  return 'ok'
}

/** Two failures in a row is an outage, not a blip: that is what turns the warning critical. */
export function isOutage(checks: PageCheck[]): boolean {
  return checks.length >= 2 && !checks[0].ok && !checks[1].ok
}
