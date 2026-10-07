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

/** Pages per client the probe checks: every sync requests each one, so the list stays short. */
export const MAX_PAGES_PER_CLIENT = 5

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null
}

/**
 * Whether a resolved address is on the public internet. A public name can point at a private one,
 * so the probe checks what the name resolves to, not just the text of the URL.
 */
export function isPublicAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const v4 = ipv4Parts(mapped ? mapped[1] : ip)
  if (v4) {
    const [a, b] = v4
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || (b === 0 && v4[2] === 0))) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    return true
  }
  const v6 = ip.toLowerCase()
  if (!v6.includes(':')) return false
  if (v6 === '::' || v6 === '::1') return false
  return !/^(f[cd]|fe[89ab]|ff)/.test(v6)
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
