import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('watchers and alerts (0059)', () => {
  let clientId: string
  let funnelId: string
  let frontId: string
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  beforeAll(async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `watchers-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Watchers', slug: `watchers-${Date.now()}` }).select().single()
    clientId = client!.id
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'T15', slug: 't15' }).select().single()
    funnelId = funnel!.id
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnelId, code: 'GRA', name: 'Gratuita' }).select().single()
    frontId = front!.id
    await admin.from('naming_rules').insert({ front_id: frontId, kind: 'include', value: '[GER]' })
    await admin.from('campaign_daily').insert({
      client_id: clientId, data: yesterday, campaign_id: 'g1', campaign_name: '[GER] captação', spend: 1000, impressions: 20000, link_clicks: 400, landing_page_views: 300, leads: 10,
    })
  })

  async function alertsOf(watcherId: string) {
    const { data } = await admin.from('alerts').select('severity, value, closed_at').eq('watcher_id', watcherId)
    return data ?? []
  }

  it('opens one alert when the metric leaves the band and closes it when it comes back', async () => {
    const { data: watcher } = await admin
      .from('watchers')
      .insert({ client_id: clientId, sales_funnel_id: funnelId, front_id: frontId, metric: 'cpl', target: 50, warn_pct: 20, crit_pct: 40 })
      .select()
      .single()
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    let alerts = await alertsOf(watcher!.id)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ severity: 'crit', value: 100, closed_at: null })

    await admin.from('watchers').update({ target: 110 }).eq('id', watcher!.id)
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    alerts = await alertsOf(watcher!.id)
    expect(alerts[0].closed_at).not.toBeNull()
    const { data: evaluated } = await admin.from('watchers').select('last_status, last_value, last_day').eq('id', watcher!.id).single()
    expect(evaluated).toMatchObject({ last_status: 'ok', last_value: 100, last_day: yesterday })
  })

  it('reads a rate the other way round: a connect rate below target is the bad side', async () => {
    const { data: watcher } = await admin
      .from('watchers')
      .insert({ client_id: clientId, sales_funnel_id: funnelId, metric: 'connect_rate', target: 90, warn_pct: 10, crit_pct: 30 })
      .select()
      .single()
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    // 300 / 400 = 75%, 16.7% under 90%: atenção, not crítico.
    expect((await alertsOf(watcher!.id))[0]).toMatchObject({ severity: 'warn', closed_at: null })
  })

  it('stays quiet on a day with less spend than the watcher needs to judge', async () => {
    const { data: watcher } = await admin
      .from('watchers')
      .insert({ client_id: clientId, sales_funnel_id: funnelId, metric: 'cpm', target: 1, min_spend: 5000 })
      .select()
      .single()
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect(await alertsOf(watcher!.id)).toEqual([])
    const { data } = await admin.from('watchers').select('last_status').eq('id', watcher!.id).single()
    expect(data!.last_status).toBe('sem_volume')
  })

  it('refuses a CPA watcher on a single front, since sales belong to the project', async () => {
    const { error } = await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: funnelId, front_id: frontId, metric: 'cpa_geral', target: 50 })
    expect(error).not.toBeNull()
  })
})
