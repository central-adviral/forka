import { describe, it, expect, vi } from 'vitest'
import { probeUrl } from './probe'

const publicDns = async () => [{ address: '93.184.216.34' }]

const respond = (status: number) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url
    void init
    return new Response(null, { status })
  })

describe('probeUrl', () => {
  it('reads a 2xx or a redirect as the page answering, and never follows the redirect', async () => {
    const ok = respond(200)
    expect(await probeUrl('https://www.exemplo.com.br/oferta', ok, publicDns)).toMatchObject({ ok: true, statusCode: 200, error: null })
    const redirect = respond(302)
    expect(await probeUrl('https://www.exemplo.com.br/oferta', redirect, publicDns)).toMatchObject({ ok: true, statusCode: 302 })
    expect(redirect.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('reads a 5xx and a network failure as down', async () => {
    expect(await probeUrl('https://www.exemplo.com.br', respond(502), publicDns)).toMatchObject({ ok: false, statusCode: 502, error: 'HTTP 502' })
    const broken = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await probeUrl('https://www.exemplo.com.br', broken, publicDns)).toMatchObject({ ok: false, statusCode: null, error: 'falha de conexão' })
  })

  it('does not request an address that is not a public https page', async () => {
    const fetchImpl = respond(200)
    expect(await probeUrl('https://127.0.0.1/admin', fetchImpl)).toMatchObject({ ok: false, error: 'endereço não permitido' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not request a public name that resolves to a private or metadata address', async () => {
    const fetchImpl = respond(200)
    const toLoopback = async () => [{ address: '127.0.0.1' }]
    expect(await probeUrl('https://loja.exemplo.com.br', fetchImpl, toLoopback)).toMatchObject({ ok: false, error: 'endereço não permitido' })
    const oneBad = async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }]
    expect(await probeUrl('https://loja.exemplo.com.br', fetchImpl, oneBad)).toMatchObject({ ok: false, error: 'endereço não permitido' })
    const missing = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await probeUrl('https://nao-existe.exemplo.com.br', fetchImpl, missing)).toMatchObject({ ok: false, error: 'domínio não encontrado' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
