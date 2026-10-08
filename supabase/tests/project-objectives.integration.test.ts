import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0094: objetivo do projeto', () => {
  it('takes the new objectives, keeps one plan watcher per project and judges cost per checkout and per visit', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `objective-${unique()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Objective', slug: `objective-${unique()}` }).select().single()
    const { data: funnel, error } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'Oferta nova', slug: 'oferta', resultado: 'checkout' }).select().single()
    expect(error).toBeNull()
    expect((await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'X', slug: 'x', resultado: 'conversa' })).error).not.toBeNull()

    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'OF', name: 'Oferta' }).select().single()
    await admin.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: '[OF]' })
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await admin.from('campaign_daily').insert({
      client_id: client!.id, data: yesterday, campaign_id: `of-${unique()}`, campaign_name: '[OF] Teste', spend: 400, initiate_checkout: 20, landing_page_views: 200,
    })

    const watcher = async (metric: string, isPlan: boolean) =>
      admin.from('watchers').insert({ client_id: client!.id, sales_funnel_id: funnel!.id, metric, target: 10, is_plan: isPlan }).select().single()
    const plan = await watcher('custo_checkout', true)
    expect(plan.error).toBeNull()
    expect((await watcher('custo_visita', true)).error).not.toBeNull()
    const visit = await watcher('custo_visita', false)

    const dayOf = async (id: string) => (await admin.rpc('watcher_day', { p_watcher_id: id, p_day: yesterday })).data[0]
    expect(await dayOf(plan.data!.id)).toMatchObject({ value: 20, status: 'crit' })
    expect(await dayOf(visit.data!.id)).toMatchObject({ value: 2, status: 'ok' })
  })
})
