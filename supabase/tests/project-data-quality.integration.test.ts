import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0092: de onde vem o número, e a prévia da regra', () => {
  it('counts what the CPA uses and leaves out, flags what is wrong, and previews a rule before saving', async () => {
    const email = `quality-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Quality', slug: `quality-${unique()}` }).select().single()
    const clientId = client!.id as string
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'P', slug: 'p' }).select().single()
    const { data: other } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'O', slug: 'o' }).select().single()
    const { data: ger } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'GER', name: 'Ger' }).select().single()
    const { data: pag } = await admin.from('project_fronts').insert({ sales_funnel_id: other!.id, code: 'PAG', name: 'Pag' }).select().single()
    await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'ESP', name: 'Espelho', source_sales_funnel_id: other!.id })
    await admin.from('naming_rules').insert([
      { front_id: ger!.id, kind: 'include', value: '[GER]' },
      { front_id: pag!.id, kind: 'include', value: '[PAG]' },
    ])
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: yesterday, campaign_id: `ger-${unique()}`, campaign_name: '[GER] Captação', spend: 100 },
      { client_id: clientId, data: yesterday, campaign_id: `both-${unique()}`, campaign_name: '[GER][PAG] Mista', spend: 40 },
      { client_id: clientId, data: yesterday, campaign_id: `none-${unique()}`, campaign_name: 'Institucional', spend: 30 },
    ])
    await admin.from('project_products').insert({ sales_funnel_id: funnel!.id, produto_nome: 'Curso', papel: 'entrada' })
    const sale = (id: string, utm: Record<string, string>) => ({
      sales_funnel_id: funnel!.id, external_id: `${id}-${unique()}`, data_venda: `${yesterday}T15:00:00Z`, status: 'aprovada', produto: 'Curso', ...utm,
    })
    const { error } = await admin.from('sales').insert([
      sale('ad', { utm_source: 'facebookads', utm_campaign: 'X 123456789' }),
      sale('legacy', { utm_source: 'facebookads' }),
      sale('none', {}),
    ])
    expect(error).toBeNull()

    const { data, error: qualityError } = await owner.rpc('get_project_data_quality', { p_sales_funnel_id: funnel!.id, p_since: yesterday, p_until: today })
    expect(qualityError).toBeNull()
    expect(data[0]).toMatchObject({
      vendas_entrada: 3,
      vendas_anuncio: 2,
      vendas_com_id_anuncio: 1,
      vendas_sem_utm: 1,
      cliente_campanhas_sem_frente: 2,
      cliente_campanhas_em_disputa: 1,
      espelhos_sem_janela: 1,
    })
    expect(Number(data[0].cliente_gasto_sem_frente)).toBe(70)

    // "[Mista]" on GER would take the mixed campaign, which PAG's rule also takes.
    const { data: preview, error: previewError } = await owner.rpc('preview_naming_rule', { p_front_id: ger!.id, p_kind: 'include', p_value: 'mista' })
    expect(previewError).toBeNull()
    expect(preview[0]).toMatchObject({ campaigns: 1, disputed: 1 })
    expect(Number(preview[0].spend)).toBe(40)

    const stranger = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const strangerEmail = `stranger-${unique()}@example.com`
    await admin.auth.admin.createUser({ email: strangerEmail, password: 'password123', email_confirm: true })
    await stranger.auth.signInWithPassword({ email: strangerEmail, password: 'password123' })
    expect((await stranger.rpc('get_project_data_quality', { p_sales_funnel_id: funnel!.id, p_since: yesterday, p_until: today })).error).not.toBeNull()
    expect((await stranger.rpc('preview_naming_rule', { p_front_id: ger!.id, p_kind: 'include', p_value: 'x' })).error).not.toBeNull()
  })
})
