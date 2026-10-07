import { describe, it, expect } from 'vitest'
import { isOutage, isPublicAddress, isSafeProbeUrl, pageHealth, type PageCheck } from './page-probe'

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
