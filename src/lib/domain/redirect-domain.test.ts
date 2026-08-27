import { describe, it, expect } from 'vitest'
import { resolveRedirectDomain, isCnameVerified } from './redirect-domain'

describe('resolveRedirectDomain', () => {
  it('uses the default domain when unconfigured', () => {
    expect(resolveRedirectDomain({ customDomain: null, domainStatus: 'unconfigured' }, 'app.vercel.app')).toBe(
      'app.vercel.app'
    )
  })

  it('uses the default domain while pending, even if a custom domain is set', () => {
    expect(
      resolveRedirectDomain({ customDomain: 'ir.gustavovoe.com', domainStatus: 'pending' }, 'app.vercel.app')
    ).toBe('app.vercel.app')
  })

  it('uses the custom domain once verified', () => {
    expect(
      resolveRedirectDomain({ customDomain: 'ir.gustavovoe.com', domainStatus: 'verified' }, 'app.vercel.app')
    ).toBe('ir.gustavovoe.com')
  })

  it('falls back to the default if verified but the domain is somehow null', () => {
    expect(resolveRedirectDomain({ customDomain: null, domainStatus: 'verified' }, 'app.vercel.app')).toBe(
      'app.vercel.app'
    )
  })
})

describe('isCnameVerified', () => {
  it('matches the expected Vercel CNAME target exactly', () => {
    expect(isCnameVerified(['cname.vercel-dns.com'])).toBe(true)
  })

  it('matches case-insensitively and ignores a trailing dot', () => {
    expect(isCnameVerified(['CNAME.VERCEL-DNS.COM.'])).toBe(true)
  })

  it('returns false when no record matches', () => {
    expect(isCnameVerified(['some-other-target.example.com'])).toBe(false)
  })

  it('returns false for an empty record list', () => {
    expect(isCnameVerified([])).toBe(false)
  })
})
