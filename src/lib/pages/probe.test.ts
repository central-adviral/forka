import { describe, it, expect, vi } from 'vitest'
import { probeUrl } from './probe'

const respond = (status: number) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url
    void init
    return new Response(null, { status })
  })

describe('probeUrl', () => {
  it('reads a 2xx or a redirect as the page answering, and never follows the redirect', async () => {
    const ok = respond(200)
    expect(await probeUrl('https://www.exemplo.com.br/oferta', ok)).toMatchObject({ ok: true, statusCode: 200, error: null })
    const redirect = respond(302)
    expect(await probeUrl('https://www.exemplo.com.br/oferta', redirect)).toMatchObject({ ok: true, statusCode: 302 })
    expect(redirect.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('reads a 5xx and a network failure as down', async () => {
    expect(await probeUrl('https://www.exemplo.com.br', respond(502))).toMatchObject({ ok: false, statusCode: 502, error: 'HTTP 502' })
    const broken = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await probeUrl('https://www.exemplo.com.br', broken)).toMatchObject({ ok: false, statusCode: null, error: 'falha de conexão' })
  })

  it('does not request an address that is not a public https page', async () => {
    const fetchImpl = respond(200)
    expect(await probeUrl('https://127.0.0.1/admin', fetchImpl)).toMatchObject({ ok: false, error: 'endereço não permitido' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
