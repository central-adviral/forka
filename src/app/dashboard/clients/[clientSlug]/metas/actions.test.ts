import { describe, it, expect, vi, beforeEach } from 'vitest'

const role = vi.hoisted(() => ({ has: false }))
const evaluate = vi.hoisted(() => vi.fn(async () => ({ data: 2, error: null })))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ rpc: async () => ({ data: role.has, error: null }) }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn(() => ({ rpc: evaluate })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))

import { evaluateNow } from './actions'

const context = { client_id: 'client-1', client_slug: 'voe' }

describe('evaluateNow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a member below gestor before the service role writes alerts', async () => {
    role.has = false
    await expect(evaluateNow(context)).rejects.toThrow('Cliente não encontrado')
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('evaluates the watchers for a gestor', async () => {
    role.has = true
    await expect(evaluateNow(context)).rejects.toThrow(/redirect:.*ok=/)
    expect(evaluate).toHaveBeenCalledWith('evaluate_watchers', { p_client_id: 'client-1' })
  })
})
