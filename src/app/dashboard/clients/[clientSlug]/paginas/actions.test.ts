import { describe, it, expect, vi, beforeEach } from 'vitest'

const role = vi.hoisted(() => ({
  has: false,
  activePages: 0,
  inserted: [] as unknown[],
  existing: [] as unknown[],
  updated: [] as unknown[],
  updateResult: { data: [{ id: 'page-1' }] as unknown[] | null, error: null as { code: string; message: string } | null },
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    rpc: async () => ({ data: role.has, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ count: role.activePages }),
          then: (resolve: (value: unknown) => void) => resolve({ data: role.existing, error: null }),
        }),
      }),
      update: (row: unknown) => {
        role.updated.push(row)
        return { eq: () => ({ eq: () => ({ select: async () => role.updateResult }) }) }
      },
      insert: async (row: unknown) => {
        role.inserted.push(row)
        return { error: null }
      },
    }),
  }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/pages/probe', () => ({ probeClientPages: vi.fn(async () => 1) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))

import { checkPagesNow, linkPage, savePage } from './actions'
import { probeClientPages } from '@/lib/pages/probe'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { revalidatePath } from 'next/cache'

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

describe('savePage', () => {
  const form = () => {
    const data = new FormData()
    data.set('label', 'Vendas')
    data.set('tipo', 'vendas')
    data.set('url', 'https://www.exemplo.com.br/oferta')
    data.set('watch_pixel', 'on')
    return data
  }

  beforeEach(() => {
    role.inserted = []
    role.existing = []
  })

  it('refuses an 11th active page', async () => {
    role.activePages = 10
    await expect(savePage(context, form())).rejects.toThrow(/redirect:.*erro=.*10%20p%C3%A1ginas/)
    expect(role.inserted).toEqual([])
  })

  it('adds the page with what it watches while there is a free slot', async () => {
    role.activePages = 9
    await expect(savePage(context, form())).rejects.toThrow(/redirect:.*ok=/)
    expect(role.inserted).toEqual([
      { client_id: 'client-1', label: 'Vendas', tipo: 'vendas', url: 'https://www.exemplo.com.br/oferta', sales_funnel_id: null, front_id: null, watch_pixel: true, watch_checkout: false, required_text: null },
    ])
  })

  it('sends an address already in the probe back to the form instead of adding it twice', async () => {
    role.activePages = 1
    role.existing = [{ id: 'page-1', label: 'Vendas', url: 'https://www.exemplo.com.br/oferta/?utm_source=x', project: { name: '1K' }, front: { name: 'Frio' } }]
    await expect(savePage(context, form())).rejects.toThrow(/redirect:\/dashboard\/clients\/voe\/paginas\/nova\?url=/)
    expect(role.inserted).toEqual([])
  })
})

describe('linkPage', () => {
  const pageContext = { ...context, page_id: 'page-1' }
  const projectId = '11111111-1111-4111-8111-111111111111'
  const frontId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    role.updated = []
    role.updateResult = { data: [{ id: 'page-1' }], error: null }
  })

  it('sets project and front together and refreshes the list', async () => {
    await expect(linkPage(pageContext, { sales_funnel_id: projectId, front_id: frontId })).resolves.toEqual({ error: null })
    expect(role.updated).toEqual([{ sales_funnel_id: projectId, front_id: frontId }])
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/clients/voe/paginas')
  })

  it('unlinks the page from any project', async () => {
    await expect(linkPage(pageContext, { sales_funnel_id: null, front_id: null })).resolves.toEqual({ error: null })
    expect(role.updated).toEqual([{ sales_funnel_id: null, front_id: null }])
  })

  it('refuses a front without its project before writing', async () => {
    await expect(linkPage(pageContext, { sales_funnel_id: null, front_id: frontId })).resolves.toEqual({ error: 'Projeto ou frente inválidos.' })
    expect(role.updated).toEqual([])
  })

  it('reports a front of another project', async () => {
    role.updateResult = { data: null, error: { code: '23514', message: 'front cannot own page' } }
    await expect(linkPage(pageContext, { sales_funnel_id: projectId, front_id: frontId })).resolves.toEqual({ error: 'Essa frente não é deste projeto.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('reports a role below gestor, whose update touches no row', async () => {
    role.updateResult = { data: [], error: null }
    await expect(linkPage(pageContext, { sales_funnel_id: projectId, front_id: null })).resolves.toEqual({ error: 'Só gestor ou owner pode ligar a página.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
