// What the page probe decides, kept apart from the network so it can be tested.

/** A response slower than this to its headers is "lenta": the ad click waits that long for anything. */
export const PAGE_SLOW_MS = 3000
/** Hops the probe follows; a longer chain is treated as broken. */
export const MAX_REDIRECTS = 3
/** Only the start of the final HTML is read: the pixel and the checkout link live near the top. */
export const MAX_HTML_BYTES = 512 * 1024
export const CERT_WARN_DAYS = 14
/** A linked project with no spend in this many days: the page is up but nobody is sent to it. */
export const NO_TRAFFIC_DAYS = 3
/** A day whose LPV per click falls this far below the 7-day average is flagged. */
export const LPV_DROP = 0.25

/** Pages per client the probe checks: every sync requests each one, so the list stays short. */
export const MAX_PAGES_PER_CLIENT = 10

export interface PageCheck {
  ok: boolean
  ttfbMs: number | null
  statusCode: number | null
  error: string | null
  checkedAt: string
  finalUrl: string | null
  redirects: number
  /** Null when the page does not watch that item. */
  pixelFound: boolean | null
  checkoutUrl: string | null
  checkoutOk: boolean | null
  textFound: boolean | null
  certExpiresAt: string | null
}

export interface PageWatch {
  watchPixel: boolean
  watchCheckout: boolean
  requiredText: string | null
}

/**
 * The server requests whatever URL a gestor types, so only public https pages are probed: no IP
 * literals and no local or internal names. Every redirect hop passes this check too (see probe.ts).
 */
export function isSafeProbeUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  // Only the standard https port: another port is another service on the same host.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return false
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || host === 'localhost' || /\.(local|localhost|internal|lan|home|test)$/.test(host)) return false
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return false
  return true
}

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

// --- What the HTML says ---

export function hasMetaPixel(html: string): boolean {
  return /connect\.facebook\.net\/[^"'\s]*fbevents\.js/i.test(html) || /fbq\(\s*['"]init['"]/.test(html)
}

function isHublaHost(host: string): boolean {
  return host === 'hub.la' || host.endsWith('.hub.la')
}

/** The first link on the page to a Hubla checkout, absolute; null when there is none. */
export function findCheckoutLink(html: string, baseUrl: string): string | null {
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), baseUrl)
      if (url.protocol === 'https:' && isHublaHost(url.hostname.toLowerCase())) return url.toString()
    } catch {
      // A malformed href is not a checkout link.
    }
  }
  return null
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Case-insensitive, on the text a visitor reads (tags and spacing ignored). */
export function containsText(html: string, text: string): boolean {
  return visibleText(html).includes(text.replace(/\s+/g, ' ').trim().toLowerCase())
}

export function pageTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 60) : null
}

// --- Status ---

export type PageStatus = 'critico' | 'atencao' | 'sem_trafego' | 'ok' | 'sem_check'

export interface Finding {
  id: 'abre' | 'redireciona' | 'velocidade' | 'certificado' | 'pixel' | 'checkout' | 'texto'
  label: string
  ok: boolean
  detail: string
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')}s`

export function certDaysLeft(check: PageCheck, now: Date): number | null {
  return check.certExpiresAt ? Math.floor((new Date(check.certExpiresAt).getTime() - now.getTime()) / 86_400_000) : null
}

/** What one check found, item by item, in the words the screen shows. */
export function checkFindings(check: PageCheck, watch: PageWatch, now: Date): Finding[] {
  const findings: Finding[] = [
    { id: 'abre', label: 'Abre', ok: check.ok, detail: check.ok ? `respondeu ${check.statusCode ?? ''}`.trim() : (check.error ?? 'não respondeu') },
  ]
  if (check.redirects > 0) {
    findings.push({
      id: 'redireciona',
      label: 'Redireciona',
      ok: check.ok,
      detail: `${check.redirects}x${check.finalUrl ? ` até ${check.finalUrl}` : ''}${check.ok ? '' : ', e o fim da cadeia falhou'}`,
    })
  }
  if (!check.ok) return findings
  if (check.ttfbMs !== null) {
    findings.push({ id: 'velocidade', label: 'Servidor', ok: check.ttfbMs <= PAGE_SLOW_MS, detail: `${seconds(check.ttfbMs)} para responder` })
  }
  const days = certDaysLeft(check, now)
  if (days !== null) {
    findings.push({ id: 'certificado', label: 'Certificado', ok: days >= CERT_WARN_DAYS, detail: days < 0 ? 'vencido' : `vence em ${days} ${days === 1 ? 'dia' : 'dias'}` })
  }
  if (watch.watchPixel && check.pixelFound !== null) {
    findings.push({ id: 'pixel', label: 'Pixel do Meta', ok: check.pixelFound, detail: check.pixelFound ? 'encontrado' : 'não encontrado no HTML' })
  }
  if (watch.watchCheckout && check.checkoutOk !== null) {
    findings.push({
      id: 'checkout',
      label: 'Botão de compra',
      ok: check.checkoutOk,
      detail: check.checkoutOk ? 'checkout da Hubla responde' : check.checkoutUrl ? 'o checkout da Hubla não respondeu' : 'nenhum link da Hubla na página',
    })
  }
  if (watch.requiredText && check.textFound !== null) {
    findings.push({ id: 'texto', label: `Texto “${watch.requiredText}”`, ok: check.textFound, detail: check.textFound ? 'encontrado' : 'sumiu da página' })
  }
  return findings
}

/** Two failures in a row is an outage, not a blip; a redirect chain that ends in an error is one at once. */
export function isCritical(checks: Pick<PageCheck, 'ok' | 'redirects'>[]): boolean {
  const [last, previous] = checks
  if (!last || last.ok) return false
  return last.redirects > 0 || (previous !== undefined && !previous.ok)
}

/**
 * Status from the newest checks first. `projectSpend` is the linked project's spend in the last
 * NO_TRAFFIC_DAYS days; null when the page has no project.
 */
export function pageStatus(checks: PageCheck[], watch: PageWatch, now: Date, projectSpend: number | null = null): PageStatus {
  const last = checks[0]
  if (!last) return 'sem_check'
  if (isCritical(checks)) return 'critico'
  if (checkFindings(last, watch, now).some((finding) => !finding.ok)) return 'atencao'
  if (projectSpend !== null && projectSpend <= 0) return 'sem_trafego'
  return 'ok'
}

export function isSilenced(silencedUntil: string | null, now: Date): boolean {
  return silencedUntil !== null && new Date(silencedUntil).getTime() > now.getTime()
}

export interface Outage {
  since: string
  /** The first check that answered again; null while still down. */
  until: string | null
  checks: number
}

/** Runs of failed checks that became an outage (see isCritical), newest first. */
export function outages(checks: PageCheck[]): Outage[] {
  const found: Outage[] = []
  let run: PageCheck[] = []
  const close = (until: string | null) => {
    if (run.length >= 2 || run.some((check) => check.redirects > 0)) found.push({ since: run[0].checkedAt, until, checks: run.length })
    run = []
  }
  // Oldest first, so a run starts at its first failure.
  for (const check of [...checks].reverse()) {
    if (!check.ok) run.push(check)
    else if (run.length > 0) close(check.checkedAt)
  }
  if (run.length > 0) close(null)
  return found.reverse()
}

/** Share of checks that answered, 0..1; null without checks. */
export function availability(checks: PageCheck[]): number | null {
  return checks.length === 0 ? null : checks.filter((check) => check.ok).length / checks.length
}

/** Spend per hour so far today; the first hour counts as a whole one so a few minutes in do not inflate it. */
export function spendPerHour(spendToday: number, hoursIntoDay: number): number {
  return spendToday <= 0 || hoursIntoDay <= 0 ? 0 : spendToday / Math.max(hoursIntoDay, 1)
}

/**
 * What a fall costs, estimated: the spend rate today of the page's front (of its project when it has
 * no front) times the hours the page has been down.
 */
export function outageCost(spendToday: number, hoursIntoDay: number, downSince: Date, now: Date): number {
  const hoursDown = Math.max(0, (now.getTime() - downSince.getTime()) / 3_600_000)
  return spendPerHour(spendToday, hoursIntoDay) * hoursDown
}

// --- Fronts ---

/** Fronts that spent in the last NO_TRAFFIC_DAYS days and have no active page: ads sending people nowhere the probe watches. */
export function frontsWithoutPage(fronts: { id: string; spendRecent: number }[], pages: { frontId: string | null; isActive: boolean }[]): Set<string> {
  const watched = new Set(pages.flatMap((page) => (page.isActive && page.frontId ? [page.frontId] : [])))
  return new Set(fronts.filter((front) => front.spendRecent > 0 && !watched.has(front.id)).map((front) => front.id))
}

export interface FrontGroup<P> {
  /** Null is "sem frente · orgânico". */
  frontId: string | null
  pages: P[]
  unwatched: boolean
}

export interface ProjectGroup<P> {
  /** Null is the last group: pages with no project. */
  projectId: string | null
  fronts: FrontGroup<P>[]
}

/**
 * Pages by project, then by front, in the order given. A project shows when it has a page or an
 * unwatched front; a front shows when it has a page or is unwatched. A page whose front is not in
 * its project's list falls under "sem frente" rather than out of the screen.
 */
export function groupPagesByFront<P extends { salesFunnelId: string | null; frontId: string | null }>(
  pages: P[],
  projects: { id: string; frontIds: string[] }[],
  unwatched: Set<string>
): ProjectGroup<P>[] {
  const groups: ProjectGroup<P>[] = []
  for (const project of projects) {
    const own = pages.filter((page) => page.salesFunnelId === project.id)
    const fronts: FrontGroup<P>[] = project.frontIds
      .map((frontId) => ({ frontId, pages: own.filter((page) => page.frontId === frontId), unwatched: unwatched.has(frontId) }))
      .filter((front) => front.pages.length > 0 || front.unwatched)
    const organic = own.filter((page) => page.frontId === null || !project.frontIds.includes(page.frontId))
    if (organic.length > 0) fronts.push({ frontId: null, pages: organic, unwatched: false })
    if (fronts.length > 0) groups.push({ projectId: project.id, fronts })
  }
  const known = new Set(projects.map((project) => project.id))
  const loose = pages.filter((page) => page.salesFunnelId === null || !known.has(page.salesFunnelId))
  if (loose.length > 0) groups.push({ projectId: null, fronts: [{ frontId: null, pages: loose, unwatched: false }] })
  return groups
}

export interface LpvDay {
  day: string
  /** Landing page views per link click; null on a day without clicks. */
  rate: number | null
  dropped: boolean
}

/** Whether the people who click reach the page: LPV ÷ link clicks per day, flagged against the average. */
export function lpvSignal(days: { day: string; linkClicks: number; landingPageViews: number }[]): { average: number | null; days: LpvDay[] } {
  const rates = days.map((day) => ({ day: day.day, rate: day.linkClicks > 0 ? day.landingPageViews / day.linkClicks : null }))
  const known = rates.flatMap((day) => (day.rate === null ? [] : [day.rate]))
  const average = known.length > 0 ? known.reduce((sum, rate) => sum + rate, 0) / known.length : null
  return {
    average,
    days: rates.map((day) => ({ ...day, dropped: average !== null && day.rate !== null && day.rate < average * (1 - LPV_DROP) })),
  }
}

// --- A/B destinations ---

/** The page part of a URL (no query, no hash, no trailing slash), to compare pages. */
export function pageKey(raw: string): string | null {
  try {
    const url = new URL(raw)
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export interface AbDestination {
  testName: string
  testActive: boolean
  variantName: string
  url: string
}

export interface PageSuggestion {
  url: string
  source: string
}

/** A/B destinations not in the probe yet, active tests first, one per page. */
export function suggestPages(destinations: AbDestination[], pageUrls: string[]): PageSuggestion[] {
  const taken = new Set(pageUrls.map(pageKey))
  const seen = new Set<string>()
  const suggestions: PageSuggestion[] = []
  for (const destination of [...destinations].sort((a, b) => Number(b.testActive) - Number(a.testActive))) {
    const key = pageKey(destination.url)
    if (!key || taken.has(key) || seen.has(key)) continue
    const url = new URL(destination.url)
    const clean = `https://${url.host}${url.pathname}`
    if (!isSafeProbeUrl(clean)) continue
    seen.add(key)
    suggestions.push({ url: clean, source: `Link A/B ${destination.testName} · variante ${destination.variantName}` })
  }
  return suggestions
}

/** The A/B tests whose variant sends people to this page. */
export function testsPointingTo(destinations: AbDestination[], pageUrl: string): string[] {
  const key = pageKey(pageUrl)
  return [...new Set(destinations.filter((destination) => pageKey(destination.url) === key).map((destination) => destination.testName))]
}
