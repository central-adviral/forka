import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  isGestor: true,
  deleted: [{ valid_from: '2026-09-01' }] as { valid_from: string }[],
  filters: [] as [string, unknown][],
  deletes: 0,
}))

function from() {
  const builder = {
    delete: () => {
      db.deletes += 1
      return builder
    },
    eq: (column: string, value: unknown) => {
      db.filters.push([column, value])
      return builder
    },
    select: () => builder,
    then: (resolve: (value: unknown) => void) => resolve({ data: db.deleted, error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ from, rpc: async () => ({ data: db.isGestor, error: null }) }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/vercel/domains', () => ({ addProjectDomain: vi.fn(), removeProjectDomain: vi.fn() }))
vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { removeMetaTax } from './actions'

const context = { client_id: '11111111-1111-4111-8111-111111111111', client_slug: 'voe', valid_from: '2026-09-01' }

describe('removeMetaTax', () => {
  beforeEach(() => {
    db.isGestor = true
    db.deleted = [{ valid_from: '2026-09-01' }]
    db.filters = []
    db.deletes = 0
  })

  it('removes the rate of that client and day', async () => {
    await removeMetaTax(context)
    expect(db.deletes).toBe(1)
    expect(db.filters).toEqual([
      ['client_id', context.client_id],
      ['valid_from', '2026-09-01'],
    ])
  })

  it('refuses a member below gestor before deleting', async () => {
    db.isGestor = false
    await expect(removeMetaTax(context)).rejects.toThrow('Cliente não encontrado')
    expect(db.deletes).toBe(0)
  })

  it('reports a delete that found nothing', async () => {
    db.deleted = []
    await expect(removeMetaTax(context)).rejects.toThrow('Taxa não encontrada ou sem permissão para remover.')
  })
})
