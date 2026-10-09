import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getWatchers } from '@/lib/repo/watchers-repo'
import { getBacklog } from '@/lib/repo/backlog-repo'
import { ensureResultWatchers } from '@/lib/repo/result-meta-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const spDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
let campaignSeq = 0

interface Effective {
  target: number | null
  effective_target: number | null
  target_source: string | null
  target_stage_id: string | null
  effective_warn_pct: number
  effective_crit_pct: number
}

describe('0106: metas que valem de cima para baixo', () => {
  let clientId: string
  let owner: SupabaseClient
  let cliente: SupabaseClient

  const signIn = async (prefix: string) => {
    const email = `${prefix}-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const session = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await session.auth.signInWithPassword({ email, password: 'password123' })
    return { id: user!.user!.id, session }
  }

  beforeAll(async () => {
    const user = await signIn('heranca')
    owner = user.session
    const member = await signIn('heranca-cliente')
    cliente = member.session
    const { data: client } = await admin.from('clients').insert({ owner_id: user.id, name: 'Herança', slug: `heranca-${unique()}` }).select().single()
    clientId = client!.id
    await admin.from('memberships').insert({ client_id: clientId, user_id: member.id, role: 'cliente' })
  })

  const insert = async <T = { id: string }>(table: string, values: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.from(table).insert(values).select().single()
    expect(error).toBeNull()
    return data as T
  }
  const setup = async () => {
    const funnel = await insert<{ id: string }>('sales_funnels', { client_id: clientId, name: 'P', slug: `p-${unique()}`, resultado: 'compra' })
    const cap = await insert('funnel_stages', { sales_funnel_id: funnel.id, name: 'Captação', measure: 'lead', position: 0, meta: 6 })
    const vnd = await insert('funnel_stages', { sales_funnel_id: funnel.id, name: 'Vendas', measure: 'compra', position: 1, meta: 55, meta_roas: 2 })
    const follower = await insert('project_fronts', { sales_funnel_id: funnel.id, stage_id: cap.id, code: `A${unique().slice(-5)}`, name: 'Frio' })
    const own = await insert('project_fronts', { sales_funnel_id: funnel.id, stage_id: cap.id, code: `B${unique().slice(-5)}`, name: 'Quente', metrica_principal: 'lead', alvo_principal: 4.5 })
    return { funnel, cap, vnd, follower, own }
  }
  const watcher = (funnelId: string, values: Record<string, unknown>) => insert('watchers', { client_id: clientId, sales_funnel_id: funnelId, ...values })
  const effective = async (id: string) =>
    (await admin.from('watchers').select('target, effective_target, target_source, target_stage_id, effective_warn_pct, effective_crit_pct').eq('id', id).single()).data as unknown as Effective
  const num = (value: unknown) => (value === null ? null : Number(value))

  it('a watcher follows its front, its stage or the result stage unless it has its own target; the band follows the funnel', async () => {
    const { funnel, cap, vnd, follower, own } = await setup()
    const plan = await watcher(funnel.id, { metric: 'cpa_geral', target: null, is_plan: true, plan_role: 'principal' })
    const followsFront = await watcher(funnel.id, { metric: 'cpl', front_id: follower.id })
    const frontOwn = await watcher(funnel.id, { metric: 'cpl', front_id: own.id })
    const ofStage = await watcher(funnel.id, { metric: 'cpl', stage_id: cap.id, warn_pct: 5, crit_pct: 10 })
    const specific = await watcher(funnel.id, { metric: 'cpl', target: 7 })
    const ctr = await watcher(funnel.id, { metric: 'ctr' })

    expect(await effective(plan.id)).toMatchObject({ effective_target: 55, target_source: 'etapa', target_stage_id: vnd.id, effective_warn_pct: 20, effective_crit_pct: 40 })
    expect(await effective(followsFront.id)).toMatchObject({ effective_target: 6, target_source: 'etapa', target_stage_id: cap.id })
    expect(await effective(frontOwn.id)).toMatchObject({ effective_target: 4.5, target_source: 'frente', target_stage_id: null })
    expect(await effective(ofStage.id)).toMatchObject({ effective_target: 6, target_source: 'etapa', effective_warn_pct: 5, effective_crit_pct: 10 })
    expect(await effective(specific.id)).toMatchObject({ effective_target: 7, target_source: 'especifica' })
    expect(await effective(ctr.id)).toMatchObject({ effective_target: null, target_source: null })

    // The stage meta moves what follows it; the specific ones stay.
    expect((await owner.from('funnel_stages').update({ meta: 8 }).eq('id', cap.id).select('id')).data).toHaveLength(1)
    expect(num((await effective(followsFront.id)).effective_target)).toBe(8)
    expect(num((await effective(ofStage.id)).effective_target)).toBe(8)
    expect(num((await effective(frontOwn.id)).effective_target)).toBe(4.5)
    expect(num((await effective(specific.id)).effective_target)).toBe(7)

    // One source for the result: the compra stage meta is the funnel result's meta.
    await owner.from('funnel_stages').update({ meta: 60 }).eq('id', vnd.id)
    expect(num((await effective(plan.id)).effective_target)).toBe(60)

    // The faixa padrão reaches every watcher without a band of its own.
    expect((await owner.from('sales_funnels').update({ warn_pct: 15, crit_pct: 30 }).eq('id', funnel.id).select('id')).data).toHaveLength(1)
    expect(await effective(plan.id)).toMatchObject({ effective_warn_pct: 15, effective_crit_pct: 30 })
    expect(await effective(ofStage.id)).toMatchObject({ effective_warn_pct: 5, effective_crit_pct: 10 })
    expect((await admin.from('watchers').update({ warn_pct: 10 }).eq('id', specific.id)).error).not.toBeNull()

    // What the screens read, on the user's session.
    const listed = await getWatchers(owner, clientId, funnel.id)
    expect(listed.find((row) => row.id === ofStage.id)).toMatchObject({ target: 8, ownTarget: null, targetSource: 'etapa', stageId: cap.id, stageName: 'Captação', warnPct: 5, ownBand: true })
    expect(listed.find((row) => row.id === plan.id)).toMatchObject({ target: 60, targetSource: 'etapa', targetStageId: vnd.id, warnPct: 15, ownBand: false })
  })

  it('a meta saved on the result stage gives the funnel its result watcher, following the stage', async () => {
    const { funnel, vnd } = await setup()
    await ensureResultWatchers(owner, clientId, funnel.id)
    const plan = (await admin.from('watchers').select('id, metric, target, effective_target, plan_role').eq('sales_funnel_id', funnel.id).is('front_id', null)).data!
    expect(plan).toEqual([expect.objectContaining({ metric: 'cpa_geral', target: null, effective_target: 55, plan_role: 'principal' })])
    await ensureResultWatchers(owner, clientId, funnel.id)
    expect((await admin.from('watchers').select('id').eq('sales_funnel_id', funnel.id).is('front_id', null)).data).toHaveLength(1)
    await owner.from('funnel_stages').update({ meta: 50 }).eq('id', vnd.id)
    expect(Number((await admin.from('watchers').select('effective_target').eq('id', plan[0].id).single()).data!.effective_target)).toBe(50)
  })

  it('making targets follow changes no judgment, and a stage watcher reads only its stage', async () => {
    const { funnel, cap, vnd, follower, own } = await setup()
    const day = spDay(-1)
    for (const [front, tag, spend, leads] of [[follower, 'FRIOX', 100, 10], [own, 'QUENTEX', 50, 25]] as const) {
      await insert('naming_rules', { front_id: front.id, kind: 'include', value: `${tag}${funnel.id.slice(0, 6)}` })
      await insert('campaign_daily', { client_id: clientId, data: day, campaign_id: `${Date.now()}${campaignSeq++}`, campaign_name: `${tag}${funnel.id.slice(0, 6)} c`, spend, leads })
    }
    const sameAsStage = await watcher(funnel.id, { metric: 'cpl', front_id: follower.id, target: 6, warn_pct: 20, crit_pct: 40 })
    const own20 = await watcher(funnel.id, { metric: 'cpl', front_id: follower.id, target: 9, warn_pct: 5, crit_pct: 10 })
    const ofStage = await watcher(funnel.id, { metric: 'cpl', stage_id: cap.id, target: 6, warn_pct: 20, crit_pct: 40 })
    const judge = async (id: string) => (await admin.rpc('watcher_day', { p_watcher_id: id, p_day: day })).data[0] as { spend: number; value: number; status: string }
    const before = await Promise.all([sameAsStage, own20, ofStage].map((w) => judge(w.id)))

    expect((await owner.rpc('normalize_funnel_targets', { p_sales_funnel_id: funnel.id })).error).toBeNull()
    expect(await effective(sameAsStage.id)).toMatchObject({ target: null, effective_target: 6, target_source: 'etapa' })
    expect((await effective(own20.id)).target).toBe(9)
    expect((await admin.from('watchers').select('warn_pct').eq('id', sameAsStage.id).single()).data!.warn_pct).toBeNull()
    expect((await admin.from('watchers').select('warn_pct').eq('id', own20.id).single()).data!.warn_pct).toBe(5)
    const after = await Promise.all([sameAsStage, own20, ofStage].map((w) => judge(w.id)))
    expect(after).toEqual(before)

    // The front FRIO spent 100 for 10 leads (CPL 10); the stage adds QUENTE: 150 for 35 leads.
    expect(Number(after[0].value)).toBeCloseTo(10)
    expect(Number(after[2].spend)).toBeCloseTo(150)
    expect(Number(after[2].value)).toBeCloseTo(150 / 35)
    expect(after[0].status).toBe('crit')

    // A stage CPA reads the stage's sales; the Alertas trail runs it on the user's session.
    const stageCpa = await watcher(funnel.id, { metric: 'cpa_geral', stage_id: vnd.id })
    const trail = await owner.rpc('watcher_series', { p_watcher_id: stageCpa.id, p_days: 3 })
    expect(trail.error).toBeNull()
    expect(trail.data).toHaveLength(3)

    // With no meta above, a following watcher judges nothing.
    await admin.from('funnel_stages').update({ meta: null }).eq('id', cap.id)
    expect((await judge(sameAsStage.id)).status).toBe('sem_meta')
    expect((await owner.rpc('normalize_funnel_targets', { p_sales_funnel_id: funnel.id })).error).toBeNull()
    expect((await cliente.rpc('normalize_funnel_targets', { p_sales_funnel_id: funnel.id })).error).not.toBeNull()
  })

  it('a test keeps the teto it started with until "usar a meta nova"', async () => {
    const { funnel, cap } = await setup()
    const item = await insert('backlog_items', { client_id: clientId, sales_funnel_id: funnel.id, code: 'T1', title: 'Isca', stage: 'anuncio', method: 'meta', funnel_stage_id: cap.id })
    const teto = async () =>
      (await admin.from('backlog_items').select('teto_inicial, teto_medida, effective_teto, effective_teto_source, effective_teto_medida').eq('id', item.id).single()).data as {
        teto_inicial: number | null
        teto_medida: string | null
        effective_teto: number | null
        effective_teto_source: string | null
        effective_teto_medida: string | null
      }
    expect(await teto()).toMatchObject({ teto_inicial: null, effective_teto: 6, effective_teto_source: 'etapa', effective_teto_medida: 'cpl' })

    expect((await owner.from('backlog_items').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', item.id).select('id')).data).toHaveLength(1)
    expect(await teto()).toMatchObject({ teto_inicial: 6, teto_medida: 'cpl' })

    // The stage meta changes: the test shows it but keeps judging with 6.
    await owner.from('funnel_stages').update({ meta: 7 }).eq('id', cap.id)
    expect(await teto()).toMatchObject({ teto_inicial: 6, effective_teto: 7 })
    expect((await cliente.rpc('use_current_teto', { p_item_id: item.id })).data).toBe(false)
    expect((await owner.rpc('use_current_teto', { p_item_id: item.id })).data).toBe(true)
    expect(await teto()).toMatchObject({ teto_inicial: 7, teto_medida: 'cpl' })

    // The Critérios override wins over the stage for what a test would get; the running one keeps its own.
    await owner.from('sales_funnels').update({ test_rules: { mult: 1.5, min: 10, conf: 95, minVisits: 500, sat: 10, teto: 20 } }).eq('id', funnel.id)
    expect(await teto()).toMatchObject({ teto_inicial: 7, effective_teto: 20, effective_teto_source: 'criterios' })

    // A teto of the test's own is about this test: it takes effect right away.
    await owner.from('backlog_items').update({ teto: 5 }).eq('id', item.id)
    expect(await teto()).toMatchObject({ teto_inicial: 5, effective_teto: 5, effective_teto_source: 'especifica' })
    const [read] = await getBacklog(owner, funnel.id)
    expect(read).toMatchObject({ teto: 5, tetoInicial: 5, tetoMedida: 'cpl', tetoNow: { value: 5, source: 'especifica', medida: 'cpl' } })
  })

  it('judges a compra stage with only a ROAS meta by ROAS, and an ascensão stage by nothing', async () => {
    const funnel = await insert<{ id: string }>('sales_funnels', { client_id: clientId, name: 'R', slug: `r-${unique()}`, resultado: 'compra', test_rules: { mult: 1.5 } })
    const roas = await insert('funnel_stages', { sales_funnel_id: funnel.id, name: 'Vendas', measure: 'compra', meta_roas: 3 })
    const asc = await insert('funnel_stages', { sales_funnel_id: funnel.id, name: 'Ascensão', measure: 'ascensao', meta: 0.1, position: 1 })
    const one = await insert('backlog_items', { client_id: clientId, sales_funnel_id: funnel.id, code: 'T1', title: 'A', stage: 'anuncio', method: 'meta', funnel_stage_id: roas.id, status: 'running' })
    const two = await insert('backlog_items', { client_id: clientId, sales_funnel_id: funnel.id, code: 'T2', title: 'B', stage: 'anuncio', method: 'meta', funnel_stage_id: asc.id })
    const read = async (id: string) => (await admin.from('backlog_items').select('teto_inicial, teto_medida, effective_teto_medida').eq('id', id).single()).data
    expect(await read(one.id)).toMatchObject({ teto_inicial: 3, teto_medida: 'roas', effective_teto_medida: 'roas' })
    expect(await read(two.id)).toMatchObject({ effective_teto_medida: null })
  })
})
