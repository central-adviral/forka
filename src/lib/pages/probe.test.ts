import { describe, it, expect, vi } from 'vitest'
import { probePage, type ProbeDeps } from './probe'
import { MAX_HTML_BYTES, type PageWatch } from '@/lib/domain/page-probe'

const PUBLIC = '93.184.216.34'
const watchNothing: PageWatch = { watchPixel: false, watchCheckout: false, requiredText: null }
const watchAll: PageWatch = { watchPixel: true, watchCheckout: true, requiredText: 'R$ 497' }

/** A fake web: each URL answers with a status, an optional Location and an optional body. */
function web(routes: Record<string, { status: number; location?: string; body?: string }>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init
    const route = routes[String(input)]
    if (!route) throw new TypeError('fetch failed')
    return new Response(route.body ?? null, { status: route.status, headers: route.location ? { location: route.location } : {} })
  })
}

function deps(fetchImpl: ReturnType<typeof web>, extra: Partial<ProbeDeps> = {}): Partial<ProbeDeps> {
  return { fetch: fetchImpl as unknown as typeof fetch, lookup: async () => [{ address: PUBLIC }], certExpiry: async () => new Date('2027-01-01T00:00:00Z'), ...extra }
}

describe('probePage', () => {
  it('reads a 2xx as up and a 5xx or a network failure as down, without following anything by itself', async () => {
    const ok = web({ 'https://www.exemplo.com.br/oferta': { status: 200 } })
    expect(await probePage('https://www.exemplo.com.br/oferta', watchNothing, { deps: deps(ok) })).toMatchObject({ ok: true, statusCode: 200, error: null, redirects: 0 })
    expect(ok.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    const down = web({ 'https://www.exemplo.com.br/': { status: 502 } })
    expect(await probePage('https://www.exemplo.com.br/', watchNothing, { deps: deps(down) })).toMatchObject({ ok: false, statusCode: 502, error: 'HTTP 502' })
    expect(await probePage('https://www.exemplo.com.br/', watchNothing, { deps: deps(web({})) })).toMatchObject({ ok: false, statusCode: null, error: 'falha de conexão' })
  })

  it('follows up to 3 redirects and records where it landed', async () => {
    const fetchImpl = web({
      'https://exemplo.com.br/': { status: 301, location: 'https://www.exemplo.com.br/' },
      'https://www.exemplo.com.br/': { status: 302, location: '/oferta' },
      'https://www.exemplo.com.br/oferta': { status: 200 },
    })
    expect(await probePage('https://exemplo.com.br/', watchNothing, { deps: deps(fetchImpl) })).toMatchObject({
      ok: true,
      statusCode: 200,
      redirects: 2,
      finalUrl: 'https://www.exemplo.com.br/oferta',
    })
  })

  it('treats a fourth redirect as a broken chain', async () => {
    const fetchImpl = web({
      'https://a.com.br/': { status: 302, location: 'https://b.com.br/' },
      'https://b.com.br/': { status: 302, location: 'https://c.com.br/' },
      'https://c.com.br/': { status: 302, location: 'https://d.com.br/' },
      'https://d.com.br/': { status: 302, location: 'https://e.com.br/' },
    })
    expect(await probePage('https://a.com.br/', watchNothing, { deps: deps(fetchImpl) })).toMatchObject({ ok: false, redirects: 3, error: 'mais de 3 redirecionamentos' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('refuses a hop to a private address, by URL or by what the name resolves to', async () => {
    const toIp = web({ 'https://www.exemplo.com.br/': { status: 302, location: 'https://169.254.169.254/latest/meta-data' } })
    expect(await probePage('https://www.exemplo.com.br/', watchNothing, { deps: deps(toIp) })).toMatchObject({ ok: false, redirects: 1, error: 'endereço não permitido' })
    expect(toIp).toHaveBeenCalledTimes(1)

    const toName = web({
      'https://www.exemplo.com.br/': { status: 302, location: 'https://interno.exemplo.com.br/' },
      'https://interno.exemplo.com.br/': { status: 200 },
    })
    const lookup = async (hostname: string) => [{ address: hostname === 'interno.exemplo.com.br' ? '10.0.0.5' : PUBLIC }]
    expect(await probePage('https://www.exemplo.com.br/', watchNothing, { deps: deps(toName, { lookup }) })).toMatchObject({ ok: false, redirects: 1, error: 'endereço não permitido' })
    expect(toName).toHaveBeenCalledTimes(1)
  })

  it('upgrades an http redirect hop to https, as a browser does', async () => {
    const fetchImpl = web({
      'https://www.exemplo.com.br/vendas': { status: 301, location: 'http://www.exemplo.com.br/vendas/' },
      'https://www.exemplo.com.br/vendas/': { status: 200 },
    })
    expect(await probePage('https://www.exemplo.com.br/vendas', watchNothing, { deps: deps(fetchImpl) })).toMatchObject({ ok: true, redirects: 1, finalUrl: 'https://www.exemplo.com.br/vendas/' })
  })

  it('does not request an address that is not a public https page', async () => {
    const fetchImpl = web({})
    expect(await probePage('https://127.0.0.1/admin', watchNothing, { deps: deps(fetchImpl) })).toMatchObject({ ok: false, error: 'endereço não permitido' })
    const toLoopback = async () => [{ address: '127.0.0.1' }]
    expect(await probePage('https://loja.exemplo.com.br', watchNothing, { deps: deps(fetchImpl, { lookup: toLoopback }) })).toMatchObject({ ok: false, error: 'endereço não permitido' })
    const missing = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await probePage('https://nao-existe.exemplo.com.br', watchNothing, { deps: deps(fetchImpl, { lookup: missing }) })).toMatchObject({ ok: false, error: 'domínio não encontrado' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks the pixel, the checkout link (probed too) and the required text in the final HTML', async () => {
    const html = `<title>Oferta</title><script src="https://connect.facebook.net/pt_BR/fbevents.js"></script><p>R$ 497</p><a href="https://pay.hub.la/abc">Comprar</a>`
    const fetchImpl = web({ 'https://www.exemplo.com.br/oferta': { status: 200, body: html }, 'https://pay.hub.la/abc': { status: 200 } })
    expect(await probePage('https://www.exemplo.com.br/oferta', watchAll, { readTitle: true, deps: deps(fetchImpl) })).toMatchObject({
      ok: true,
      pixelFound: true,
      checkoutUrl: 'https://pay.hub.la/abc',
      checkoutOk: true,
      textFound: true,
      title: 'Oferta',
      certExpiresAt: '2027-01-01T00:00:00.000Z',
    })

    const broken = web({ 'https://www.exemplo.com.br/oferta': { status: 200, body: html }, 'https://pay.hub.la/abc': { status: 404 } })
    expect(await probePage('https://www.exemplo.com.br/oferta', watchAll, { deps: deps(broken) })).toMatchObject({ checkoutOk: false, checkoutUrl: 'https://pay.hub.la/abc' })

    const bare = web({ 'https://www.exemplo.com.br/oferta': { status: 200, body: '<p>R$ 397</p>' } })
    expect(await probePage('https://www.exemplo.com.br/oferta', watchAll, { deps: deps(bare) })).toMatchObject({ pixelFound: false, checkoutUrl: null, checkoutOk: false, textFound: false })
    expect(await probePage('https://www.exemplo.com.br/oferta', watchNothing, { deps: deps(bare) })).toMatchObject({ pixelFound: null, checkoutOk: null, textFound: null })
  })

  it('reads only the start of the HTML', async () => {
    const html = `${'a'.repeat(MAX_HTML_BYTES)}<script>fbq('init', '1')</script>`
    const fetchImpl = web({ 'https://www.exemplo.com.br/longa': { status: 200, body: html } })
    expect(await probePage('https://www.exemplo.com.br/longa', { ...watchNothing, watchPixel: true }, { deps: deps(fetchImpl) })).toMatchObject({ pixelFound: false })
  })

  it('reads the certificate from the address it already checked, by the final host name', async () => {
    const certExpiry = vi.fn(async () => new Date('2026-10-15T00:00:00Z'))
    const fetchImpl = web({ 'https://exemplo.com.br/': { status: 301, location: 'https://www.exemplo.com.br/' }, 'https://www.exemplo.com.br/': { status: 200 } })
    expect(await probePage('https://exemplo.com.br/', watchNothing, { deps: deps(fetchImpl, { certExpiry }) })).toMatchObject({ certExpiresAt: '2026-10-15T00:00:00.000Z' })
    expect(certExpiry).toHaveBeenCalledWith(PUBLIC, 'www.exemplo.com.br')
  })
})
