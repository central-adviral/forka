import { describe, it, expect } from 'vitest'
import { isOutage, isSafeProbeUrl, pageHealth, type PageCheck } from './page-probe'

const check = (ok: boolean, ttfbMs: number | null = 400): PageCheck => ({ ok, ttfbMs, statusCode: ok ? 200 : 502, error: null, checkedAt: '2026-10-07T12:00:00Z' })

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
    expect(isSafeProbeUrl('não é url')).toBe(false)
  })
})

describe('pageHealth and isOutage', () => {
  it('reads the newest check: down, slow or ok', () => {
    expect(pageHealth([])).toBe('sem_check')
    expect(pageHealth([check(false), check(true)])).toBe('fora')
    expect(pageHealth([check(true, 4500)])).toBe('lenta')
    expect(pageHealth([check(true, 600)])).toBe('ok')
  })

  it('calls an outage only after two failures in a row', () => {
    expect(isOutage([check(false), check(true)])).toBe(false)
    expect(isOutage([check(false), check(false)])).toBe(true)
  })
})
