import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInUser(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, ANON_KEY)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

interface CampaignRow {
  campaign_id: string
  spend: number
  front_ids: string[]
}

describe('campaign fronts and naming rules (0053)', () => {
  let clientId: string
  let funnelId: string
  let owner: Awaited<ReturnType<typeof createSignedInUser>>
  let cliente: Awaited<ReturnType<typeof createSignedInUser>>
  let stranger: Awaited<ReturnType<typeof createSignedInUser>>
  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    owner = await createSignedInUser('cf-owner')
    cliente = await createSignedInUser('cf-cliente')
    stranger = await createSignedInUser('cf-stranger')
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: owner.userId, name: 'Campaign Fronts', slug: `campaign-fronts-${Date.now()}` })
      .select()
      .single()
    clientId = client!.id
    await admin.from('memberships').insert({ client_id: clientId, user_id: cliente.userId, role: 'cliente' })
    const { data: funnel } = await admin
      .from('sales_funnels')
      .insert({ client_id: clientId, name: 'T15', slug: 't15' })
      .select()
      .single()
    funnelId = funnel!.id
    const names = [
      ['ger-1', '07 - [MTV-T15][GER][CAPTACAO] - Escala', 100],
      ['ger-ab', '16 - [TOOL-AB][MTV-T15][GER] - Teste PV', 40],
      ['pre-1', '02 - [mtv-t15][pre][captacao] - Lote 01', 60],
      ['solta', 'Teste_Criativo_Novo_2909', 30],
    ] as const
    await admin.from('campaign_daily').insert(
      names.map(([id, name, spend]) => ({ client_id: clientId, data: today, campaign_id: id, campaign_name: name, spend }))
    )
  })

  async function campaigns(db: SupabaseClient): Promise<Map<string, CampaignRow>> {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await db.rpc('get_client_campaigns', { p_client_id: clientId, p_since: today, p_until: tomorrow })
    expect(error).toBeNull()
    return new Map((data as CampaignRow[]).map((row) => [row.campaign_id, row]))
  }

  it('leaves every campaign without a front until a front has an include rule', async () => {
    const { data: front, error } = await owner.db
      .from('project_fronts')
      .insert({ sales_funnel_id: funnelId, code: 'GRA-GER', name: 'Captação Gratuita' })
      .select()
      .single()
    expect(error).toBeNull()
    for (const row of (await campaigns(owner.db)).values()) expect(row.front_ids).toEqual([])

    await owner.db.from('naming_rules').insert([
      { front_id: front!.id, kind: 'include', value: '[MTV-T15][GER]' },
      { front_id: front!.id, kind: 'exclude', value: '[TOOL-AB]' },
    ])
    const rows = await campaigns(owner.db)
    expect(rows.get('ger-1')!.front_ids).toEqual([front!.id])
    expect(rows.get('ger-ab')!.front_ids).toEqual([])
    expect(rows.get('solta')!.front_ids).toEqual([])
  })

  it('matches regardless of upper and lower case', async () => {
    const { data: front } = await owner.db
      .from('project_fronts')
      .insert({ sales_funnel_id: funnelId, code: 'PRE', name: 'Pré-lançamento' })
      .select()
      .single()
    await owner.db.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: '[MTV-T15][PRE]' })
    expect((await campaigns(owner.db)).get('pre-1')!.front_ids).toEqual([front!.id])
  })

  it('reports a campaign taken by two fronts so its spend is not counted twice silently', async () => {
    const { data: front } = await owner.db
      .from('project_fronts')
      .insert({ sales_funnel_id: funnelId, code: 'TUDO', name: 'Tudo do T15' })
      .select()
      .single()
    await owner.db.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: 'mtv-t15' })
    expect((await campaigns(owner.db)).get('ger-1')!.front_ids).toHaveLength(2)
    await owner.db.from('project_fronts').delete().eq('id', front!.id)
  })

  it('lets a cliente read the classification but not change the rules', async () => {
    expect((await campaigns(cliente.db)).size).toBe(4)
    const { error } = await cliente.db
      .from('project_fronts')
      .insert({ sales_funnel_id: funnelId, code: 'X', name: 'Não pode' })
    expect(error).not.toBeNull()
  })

  it('shows nothing to someone outside the client', async () => {
    expect((await campaigns(stranger.db)).size).toBe(0)
    const { data } = await stranger.db.from('project_fronts').select('id').eq('sales_funnel_id', funnelId)
    expect(data).toEqual([])
  })

  it('takes the project spend from its fronts and counts every sale, past the 1000-row API cap', async () => {
    const sales = Array.from({ length: 1500 }, (_, i) => ({
      sales_funnel_id: funnelId,
      external_id: `cap-${i}`,
      data_venda: `${today}T15:00:00Z`,
      status: 'aprovada',
      valor_bruto: 10,
      valor_liquido: 9,
    }))
    for (let i = 0; i < sales.length; i += 500) {
      const { error } = await admin.from('sales').insert(sales.slice(i, i + 500))
      expect(error).toBeNull()
    }
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await owner.db.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, p_since: today, p_until: tomorrow })
    expect(error).toBeNull()
    const day = (data as { vendas: number; receita_bruta: number; spend: number; spend_source: string }[])[0]
    expect(Number(day.vendas)).toBe(1500)
    expect(Number(day.receita_bruta)).toBe(15000)
    // GRA-GER (100) + PRE (60): the [TOOL-AB] and unmatched campaigns stay out of the project.
    expect(Number(day.spend)).toBe(160)
    expect(day.spend_source).toBe('frentes')
  })

  it('sums daily spend per front of the project', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await owner.db.rpc('get_project_front_daily', { p_sales_funnel_id: funnelId, p_since: today, p_until: tomorrow })
    expect(error).toBeNull()
    const spendByFront = new Map((data as { front_id: string; spend: number }[]).map((row) => [row.front_id, Number(row.spend)]))
    expect([...spendByFront.values()].sort((a, b) => a - b)).toEqual([60, 100])
  })
})
