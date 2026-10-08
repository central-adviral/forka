import { describe, it, expect } from 'vitest'
import {
  containsText,
  findCheckoutLink,
  frontsWithoutPage,
  groupPagesByFront,
  hasMetaPixel,
  isCritical,
  isPublicAddress,
  isSafeProbeUrl,
  lpvSignal,
  outageCost,
  outages,
  pageStatus,
  pageTitle,
  spendPerHour,
  suggestPages,
  testsPointingTo,
  type PageCheck,
  type PageWatch,
} from './page-probe'

const NOW = new Date('2026-10-08T15:00:00Z')
const check = (ok: boolean, extra: Partial<PageCheck> = {}): PageCheck => ({
  ok,
  ttfbMs: ok ? 400 : null,
  statusCode: ok ? 200 : 502,
  error: ok ? null : 'HTTP 502',
  checkedAt: '2026-10-08T14:00:00Z',
  finalUrl: 'https://www.exemplo.com.br/oferta',
  redirects: 0,
  pixelFound: null,
  checkoutUrl: null,
  checkoutOk: null,
  textFound: null,
  certExpiresAt: '2027-01-01T00:00:00Z',
  ...extra,
})
const watchNothing: PageWatch = { watchPixel: false, watchCheckout: false, requiredText: null }
const watchAll: PageWatch = { watchPixel: true, watchCheckout: true, requiredText: 'R$ 497' }

describe('isSafeProbeUrl', () => {
  it('accepts a public https page', () => {
    expect(isSafeProbeUrl('https://www.exemplo.com.br/oferta?utm_source=fb')).toBe(true)
  })

  it('refuses http, IP literals, local names and credentials in the URL', () => {
    expect(isSafeProbeUrl('http://www.exemplo.com.br')).toBe(false)
    expect(isSafeProbeUrl('https://127.0.0.1/admin')).toBe(false)
    expect(isSafeProbeUrl('https://169.254.169.254/latest')).toBe(false)
    expect(isSafeProbeUrl('https://[::1]/')).toBe(false)
    expect(isSafeProbeUrl('https://localhost:3000')).toBe(false)
    expect(isSafeProbeUrl('https://db.internal/')).toBe(false)
    expect(isSafeProbeUrl('https://user:pass@exemplo.com')).toBe(false)
    expect(isSafeProbeUrl('https://www.exemplo.com.br:8443/oferta')).toBe(false)
    expect(isSafeProbeUrl('https://www.exemplo.com.br:443/oferta')).toBe(true)
    expect(isSafeProbeUrl('não é url')).toBe(false)
  })
})

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, metadata, CGNAT and their IPv6 forms', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('accepts public IPv4 and IPv6', () => {
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })
})

describe('pageStatus', () => {
  it('is critical after two failures in a row, or at once when a redirect chain ends in an error', () => {
    expect(pageStatus([], watchNothing, NOW)).toBe('sem_check')
    expect(pageStatus([check(false), check(true)], watchNothing, NOW)).toBe('atencao')
    expect(pageStatus([check(false), check(false)], watchNothing, NOW)).toBe('critico')
    expect(pageStatus([check(false, { redirects: 2, error: 'endereço não permitido' }), check(true)], watchNothing, NOW)).toBe('critico')
    expect(isCritical([check(false)])).toBe(false)
  })

  it('calls for attention on a slow server, a certificate near expiry and each watched item missing', () => {
    expect(pageStatus([check(true)], watchNothing, NOW)).toBe('ok')
    expect(pageStatus([check(true, { ttfbMs: 4500 })], watchNothing, NOW)).toBe('atencao')
    expect(pageStatus([check(true, { certExpiresAt: '2026-10-15T00:00:00Z' })], watchNothing, NOW)).toBe('atencao')
    const allFound = { pixelFound: true, checkoutUrl: 'https://pay.hub.la/x', checkoutOk: true, textFound: true }
    expect(pageStatus([check(true, allFound)], watchAll, NOW)).toBe('ok')
    expect(pageStatus([check(true, { ...allFound, pixelFound: false })], watchAll, NOW)).toBe('atencao')
    expect(pageStatus([check(true, { ...allFound, checkoutOk: false })], watchAll, NOW)).toBe('atencao')
    expect(pageStatus([check(true, { ...allFound, textFound: false })], watchAll, NOW)).toBe('atencao')
    // An item that is not watched never counts, even when the check says it is missing.
    expect(pageStatus([check(true, { pixelFound: false })], watchNothing, NOW)).toBe('ok')
  })

  it('marks a healthy page whose project spent nothing in the last days as up without traffic', () => {
    expect(pageStatus([check(true)], watchNothing, NOW, 0)).toBe('sem_trafego')
    expect(pageStatus([check(true)], watchNothing, NOW, 120)).toBe('ok')
    expect(pageStatus([check(false), check(false)], watchNothing, NOW, 0)).toBe('critico')
  })
})

describe('content detection', () => {
  it('finds the Meta pixel by its script or its init call', () => {
    expect(hasMetaPixel('<script src="https://connect.facebook.net/en_US/fbevents.js"></script>')).toBe(true)
    expect(hasMetaPixel("<script>fbq('init', '123');</script>")).toBe(true)
    expect(hasMetaPixel('<script src="https://www.googletagmanager.com/gtm.js"></script>')).toBe(false)
  })

  it('takes the first link to a Hubla checkout, made absolute', () => {
    const html = '<a href="/sobre">Sobre</a><a href="https://pay.hub.la/abc?x=1&amp;y=2">Comprar</a><a href="https://hub.la/outro">2</a>'
    expect(findCheckoutLink(html, 'https://www.exemplo.com.br/oferta')).toBe('https://pay.hub.la/abc?x=1&y=2')
    expect(findCheckoutLink('<a href="https://hub.la/z">x</a>', 'https://e.com.br')).toBe('https://hub.la/z')
    expect(findCheckoutLink('<a href="https://hub.la.golpe.com/z">x</a><a href="http://pay.hub.la/z">y</a>', 'https://e.com.br')).toBeNull()
  })

  it('looks for the required text in what the visitor reads, ignoring case, tags and spacing', () => {
    expect(containsText('<p>Por apenas <b>R$&nbsp;497</b></p>', 'r$ 497')).toBe(true)
    expect(containsText('<p>Por apenas R$ 397</p><script>var preco = "R$ 497"</script>', 'R$ 497')).toBe(false)
    expect(pageTitle('<title>\n  Oferta 1K  </title>')).toBe('Oferta 1K')
  })
})

describe('outages and their cost', () => {
  const at = (iso: string, ok: boolean) => check(ok, { checkedAt: iso })

  it('lists runs of failures that became an outage, with when they ended', () => {
    const checks = [
      at('2026-10-08T14:10:00Z', false),
      at('2026-10-08T14:05:00Z', false),
      at('2026-10-08T14:00:00Z', true),
      at('2026-10-08T13:00:00Z', false),
      at('2026-10-08T12:00:00Z', true),
      at('2026-10-08T11:00:00Z', false),
      at('2026-10-08T10:00:00Z', false),
    ]
    expect(outages(checks)).toEqual([
      { since: '2026-10-08T14:05:00Z', until: null, checks: 2 },
      { since: '2026-10-08T10:00:00Z', until: '2026-10-08T12:00:00Z', checks: 2 },
    ])
  })

  it('estimates what a fall costs from the spend rate of the day', () => {
    // R$ 600 in the first 12 hours is R$ 50/h; 90 minutes down is R$ 75.
    expect(outageCost(600, 12, new Date('2026-10-08T13:30:00Z'), NOW)).toBe(75)
    expect(outageCost(0, 12, new Date('2026-10-08T13:30:00Z'), NOW)).toBe(0)
  })

  it('prices a fall at the front rate, not the whole project', () => {
    // Project R$ 600 by noon, of which the page's front spent R$ 240: R$ 20/h, 90 minutes is R$ 30.
    expect(spendPerHour(240, 12)).toBe(20)
    expect(outageCost(240, 12, new Date('2026-10-08T13:30:00Z'), NOW)).toBe(30)
    // Twenty minutes into the day counts as a whole hour.
    expect(spendPerHour(50, 1 / 3)).toBe(50)
  })
})

describe('fronts', () => {
  const page = (id: string, salesFunnelId: string | null, frontId: string | null, isActive = true) => ({ id, salesFunnelId, frontId, isActive })

  it('flags a front that spent in the last days with no active page', () => {
    const fronts = [
      { id: 'f1', spendRecent: 300 },
      { id: 'f2', spendRecent: 120 },
      { id: 'f3', spendRecent: 0 },
      { id: 'f4', spendRecent: 80 },
    ]
    const pages = [page('a', 'p1', 'f1'), page('b', 'p1', 'f4', false)]
    expect([...frontsWithoutPage(fronts, pages)]).toEqual(['f2', 'f4'])
  })

  it('groups pages by project then front, organic last in the project, loose pages last', () => {
    const pages = [page('a', 'p1', 'f1'), page('b', 'p1', null), page('c', null, null), page('d', 'p1', 'f1'), page('e', 'p2', 'gone')]
    const groups = groupPagesByFront(
      pages,
      [
        { id: 'p1', frontIds: ['f1', 'f2', 'f3'] },
        { id: 'p2', frontIds: ['g1'] },
        { id: 'p3', frontIds: ['h1'] },
      ],
      new Set(['f2'])
    )
    expect(groups.map((group) => ({ project: group.projectId, fronts: group.fronts.map((front) => [front.frontId, front.pages.map((p) => p.id), front.unwatched]) }))).toEqual([
      { project: 'p1', fronts: [['f1', ['a', 'd'], false], ['f2', [], true], [null, ['b'], false]] },
      { project: 'p2', fronts: [[null, ['e'], false]] },
      { project: null, fronts: [[null, ['c'], false]] },
    ])
  })
})

describe('lpvSignal', () => {
  it('flags a day that drops more than 25% below the 7-day average', () => {
    const days = ['01', '02', '03', '04', '05', '06'].map((d) => ({ day: `2026-10-${d}`, linkClicks: 100, landingPageViews: 80 }))
    const signal = lpvSignal([...days, { day: '2026-10-07', linkClicks: 100, landingPageViews: 40 }, { day: '2026-10-08', linkClicks: 0, landingPageViews: 0 }])
    expect(signal.average).toBeCloseTo((80 * 6 + 40) / 7 / 100)
    expect(signal.days.filter((day) => day.dropped).map((day) => day.day)).toEqual(['2026-10-07'])
    expect(signal.days.at(-1)).toEqual({ day: '2026-10-08', rate: null, dropped: false })
  })
})

describe('A/B destinations', () => {
  const destinations = [
    { testName: 'Antigo', testActive: false, variantName: 'A', url: 'https://www.exemplo.com.br/velha' },
    { testName: 'Headline', testActive: true, variantName: 'B', url: 'https://www.exemplo.com.br/oferta-b?utm_source=fb' },
    { testName: 'Headline', testActive: true, variantName: 'A', url: 'https://www.exemplo.com.br/oferta/' },
    { testName: 'Interno', testActive: true, variantName: 'A', url: 'http://localhost/x' },
  ]

  it('suggests the pages not yet probed, active tests first, without the query', () => {
    expect(suggestPages(destinations, ['https://www.exemplo.com.br/oferta'])).toEqual([
      { url: 'https://www.exemplo.com.br/oferta-b', source: 'Teste A/B Headline · variante B' },
      { url: 'https://www.exemplo.com.br/velha', source: 'Teste A/B Antigo · variante A' },
    ])
  })

  it('names the tests that send people to a page', () => {
    expect(testsPointingTo(destinations, 'https://www.exemplo.com.br/oferta?x=1')).toEqual(['Headline'])
  })
})
