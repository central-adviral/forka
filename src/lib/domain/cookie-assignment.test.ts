import { describe, it, expect } from 'vitest'
import {
  VISITOR_COOKIE,
  assignmentCookieName,
  getOrCreateVisitorId,
  readAssignedVariantId,
} from './cookie-assignment'

describe('cookie-assignment', () => {
  it('names the assignment cookie per test slug', () => {
    expect(assignmentCookieName('oferta-x')).toBe('ir_t_oferta-x')
  })

  it('exposes a stable visitor cookie name', () => {
    expect(VISITOR_COOKIE).toBe('ir_vid')
  })

  it('reuses an existing visitor id', () => {
    const result = getOrCreateVisitorId('existing-id')
    expect(result).toEqual({ visitorId: 'existing-id', isNew: false })
  })

  it('generates a new visitor id when missing', () => {
    const result = getOrCreateVisitorId(undefined)
    expect(result.isNew).toBe(true)
    expect(result.visitorId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the assigned variant for a test slug', () => {
    const cookies = { 'ir_t_oferta-x': 'variant-b' }
    expect(readAssignedVariantId(cookies, 'oferta-x')).toBe('variant-b')
  })

  it('returns undefined when no assignment exists', () => {
    expect(readAssignedVariantId({}, 'oferta-x')).toBeUndefined()
  })
})
