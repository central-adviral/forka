import { describe, it, expect, vi, beforeEach } from 'vitest'

const role = vi.hoisted(() => ({ has: false }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ rpc: async () => ({ data: role.has, error: null }) }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/pages/probe', () => ({ probeClientPages: vi.fn(async () => 1) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))

import { checkPagesNow } from './actions'
import { probeClientPages } from '@/lib/pages/probe'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const context = { client_id: 'client-1', client_slug: 'voe' }

describe('checkPagesNow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a member below gestor before touching the service role', async () => {
    role.has = false
    await expect(checkPagesNow(context)).rejects.toThrow('Cliente não encontrado')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(probeClientPages).not.toHaveBeenCalled()
  })

  it('runs the probe for a gestor', async () => {
    role.has = true
    await expect(checkPagesNow(context)).rejects.toThrow(/redirect:.*ok=/)
    expect(probeClientPages).toHaveBeenCalledOnce()
  })
})
