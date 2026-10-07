import { describe, it, expect, vi, beforeEach } from 'vitest'

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieValue.current === undefined ? undefined : { value: cookieValue.current }) }),
}))

import { canActAs, viewingAsClient } from './view-as'

const dbWithRole = (hasRole: boolean) => ({ rpc: vi.fn(async () => ({ data: hasRole, error: null })) }) as never

describe('Ver como cliente', () => {
  beforeEach(() => {
    cookieValue.current = undefined
  })

  it('follows the real role when not previewing', async () => {
    expect(await canActAs(dbWithRole(true), 'client-1', 'gestor')).toBe(true)
    expect(await canActAs(dbWithRole(false), 'client-1', 'gestor')).toBe(false)
  })

  it('only takes permission away: previewing hides editing even from an owner', async () => {
    cookieValue.current = 'cliente'
    expect(await viewingAsClient()).toBe(true)
    expect(await canActAs(dbWithRole(true), 'client-1', 'owner')).toBe(false)
    expect(await canActAs(dbWithRole(false), 'client-1', 'gestor')).toBe(false)
  })

  it('never grants a role through any other cookie value', async () => {
    for (const value of ['owner', 'gestor', 'admin', '']) {
      cookieValue.current = value
      expect(await viewingAsClient()).toBe(false)
      expect(await canActAs(dbWithRole(false), 'client-1', 'gestor')).toBe(false)
    }
  })
})
