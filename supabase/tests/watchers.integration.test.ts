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

describe('watchers on a front, frequency and the 14-day trail (0065, 0070)', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  it('narrows a watcher to the campaigns the front rules give it, measures frequency and returns 14 closed days', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `slice-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Slice', slug: `slice-${Date.now()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const { data: escala } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'ESC', name: 'Escala' }).select().single()
    const { data: rmk } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'RMK', name: 'Remarketing' }).select().single()
    await admin.from('naming_rules').insert([
      { front_id: escala!.id, kind: 'include', value: 'Escala' },
      { front_id: rmk!.id, kind: 'include', value: 'RMK' },
    ])
    await admin.from('campaign_daily').insert([
      { client_id: client!.id, data: yesterday, campaign_id: 'e', campaign_name: '[1K] Escala', spend: 300, impressions: 30000, reach: 10000 },
      { client_id: client!.id, data: yesterday, campaign_id: 'r', campaign_name: '[1K] RMK', spend: 100, impressions: 5000, reach: 1000 },
    ])
    const { data: slice } = await admin
      .from('watchers')
      .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, front_id: rmk!.id, metric: 'frequencia', target: 3, warn_pct: 20, crit_pct: 40 })
      .select()
      .single()

    const { data: day } = await admin.rpc('watcher_day', { p_watcher_id: slice!.id, p_day: yesterday })
    // Only the RMK campaign: 5000 impressions over 1000 people = 5, 67% over a target of 3.
    expect(day[0]).toMatchObject({ spend: 100, value: 5, status: 'crit' })

    const { data: series } = await admin.rpc('watcher_series', { p_watcher_id: slice!.id, p_days: 14 })
    expect(series).toHaveLength(14)
    expect(series.at(-1)).toMatchObject({ day: yesterday, status: 'crit' })
    expect(series[0].status).toBe('sem_dado')

    const { error } = await admin
      .from('watchers')
      .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, front_id: rmk!.id, metric: 'cpa_geral', target: 30 })
    expect(error).not.toBeNull()
  })
})

describe('CPA de anúncio per front and ROAS (0086)', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  it("counts on a front only the sales whose UTM ad runs in the front's campaigns", async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `front-cpa-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'FrontCpa', slug: `front-cpa-${Date.now()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const { data: escala } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'ESC', name: 'Escala' }).select().single()
    const { data: rmk } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'RMK', name: 'Remarketing' }).select().single()
    await admin.from('naming_rules').insert([
      { front_id: escala!.id, kind: 'include', value: 'Escala' },
      { front_id: rmk!.id, kind: 'include', value: 'RMK' },
    ])
    await admin.from('campaign_daily').insert([
      { client_id: client!.id, data: yesterday, campaign_id: 'fe', campaign_name: '[1K] Escala', spend: 300, impressions: 30000 },
      { client_id: client!.id, data: yesterday, campaign_id: 'fr', campaign_name: '[1K] RMK', spend: 100, impressions: 5000 },
    ])
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: funnel!.id, source: 'launchops_sync', data: yesterday, ad_id: '880000000001', ad_name: 'Escala v1', campaign_id: 'fe', spend: 300 },
      { sales_funnel_id: funnel!.id, source: 'launchops_sync', data: yesterday, ad_id: '880000000002', ad_name: 'RMK v1', campaign_id: 'fr', spend: 100 },
    ])
    const sale = (id: string, ad: string, value: number) => ({
      sales_funnel_id: funnel!.id,
      external_id: `${id}-${Date.now()}`,
      data_venda: `${yesterday}T15:00:00Z`,
      status: 'aprovada',
      utm_campaign: ad,
      is_upsell: false,
      valor_liquido: value,
    })
    const { error: salesError } = await admin.from('sales').insert([sale('a', '880000000001', 200), sale('b', '880000000001', 200), sale('c', '880000000002', 300)])
    expect(salesError).toBeNull()

    const watcher = async (metric: string, frontId: string | null, target: number) =>
      (await admin.from('watchers').insert({ client_id: client!.id, sales_funnel_id: funnel!.id, front_id: frontId, metric, target }).select().single()).data!
    const dayOf = async (id: string) => (await admin.rpc('watcher_day', { p_watcher_id: id, p_day: yesterday })).data[0]

    // Escala: 300 of spend over its 2 sales; RMK's sale stays out.
    expect(await dayOf((await watcher('cpa_anuncio', escala!.id, 150)).id)).toMatchObject({ value: 150, status: 'ok' })
    // ROAS of the front: 400 ÷ 300, 33% under 2: under target is the bad side, atenção under 40%.
    const frontRoas = await dayOf((await watcher('roas', escala!.id, 2)).id)
    expect(Number(frontRoas.value)).toBeCloseTo(400 / 300)
    expect(frontRoas.status).toBe('warn')
    // ROAS of the project: every sale, 700 ÷ 400.
    expect(Number((await dayOf((await watcher('roas', null, 1.5)).id)).value)).toBeCloseTo(1.75)
  })
})
