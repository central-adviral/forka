import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// One name, two ads, two adsets -- the production shape that 0038 collapsed into a single row.
const SHARED = 'av.1KLT.17.V1 - Salário de Juíz'.normalize('NFC')
const SOLO = 'av.1KLT.99.V9 - Anúncio Único'.normalize('NFC')
// Ambiguous in the spend table (two ids carry it), so only the click stream can resolve it --
// and the click that carries the id sits outside the report window asked for below.
const WINDOWED = 'av.1KLT.88.V8 - Fora da Janela'.normalize('NFC')
const BEFORE_WINDOW = '2026-08-01T12:00:00Z'
const IN_WINDOW = '2026-09-05T12:00:00Z'
// Two ids that agree on name, adset, campaign AND their last six characters, so the label
// cascade runs out of tiebreakers and hands both rows the same string.
const COLLIDING = 'av.1KLT.77.V7 - Rótulo Colidido'.normalize('NFC')

let asOwner: SupabaseClient
let testId: string
let stamp: number

beforeAll(async () => {
  stamp = Date.now()
  const email = `ad-from-clicks-${stamp}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Ad From Clicks', slug: `ad-from-clicks-${stamp}` })
    .select()
    .single()
  const { data: test } = await admin
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Teste Identidade Por Id',
      slug: `teste-identidade-id-${stamp}`,
      conversion_method: 'hubla_webhook',
    })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await admin
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const { data: funnel } = await admin
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funil', slug: `funil-${stamp}` })
    .select()
    .single()

  await admin.from('ad_creative_spend_daily').insert([
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `dup-1-${stamp}`,
      ad_name: SHARED,
      adset_name: 'Conjunto Alfa',
      campaign_name: 'Campanha ABO',
      spend: 100,
      impressions: 1000,
      link_clicks: 50,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `dup-2-${stamp}`,
      ad_name: SHARED,
      adset_name: 'Conjunto Beta',
      campaign_name: 'Campanha CBO',
      spend: 60,
      impressions: 600,
      link_clicks: 30,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `solo-1-${stamp}`,
      ad_name: SOLO,
      adset_name: 'Conjunto Alfa',
      campaign_name: 'Campanha ABO',
      spend: 25,
      impressions: 250,
      link_clicks: 10,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `win-x-${stamp}`,
      ad_name: WINDOWED,
      adset_name: 'Conjunto Gama',
      campaign_name: 'Campanha ABO',
      spend: 77,
      impressions: 770,
      link_clicks: 35,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `win-y-${stamp}`,
      ad_name: WINDOWED,
      adset_name: 'Conjunto Delta',
      campaign_name: 'Campanha CBO',
      spend: 33,
      impressions: 330,
      link_clicks: 15,
    },
    // Both ids end in the same `stamp`, so right(ad_id, 6) matches and the labels collide.
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `col-a-${stamp}`,
      ad_name: COLLIDING,
      adset_name: 'Conjunto Épsilon',
      campaign_name: 'Campanha Única',
      spend: 50,
      impressions: 500,
      link_clicks: 25,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `col-b-${stamp}`,
      ad_name: COLLIDING,
      adset_name: 'Conjunto Épsilon',
      campaign_name: 'Campanha Única',
      spend: 20,
      impressions: 200,
      link_clicks: 10,
    },
  ])

  // Every row spells out created_at: a bulk insert through PostgREST sets any key a row omits
  // to NULL instead of falling back to the column default, and one NULL rejects the whole batch.
  const click = (visitorId: string, utms: Record<string, string>, createdAt = IN_WINDOW) => ({
    test_id: testId,
    variant_id: variant!.id,
    visitor_id: visitorId,
    tracking_id: crypto.randomUUID(),
    created_at: createdAt,
    source_utms: utms,
  })

  const { error: clickError } = await admin.from('click_events').insert([
    // Two ads sharing a name, each identified by its own id.
    click('v-dup1-a', { fb_ad_id: `dup-1-${stamp}`, utm_term: SHARED }),
    click('v-dup1-b', { fb_ad_id: `dup-1-${stamp}`, utm_term: SHARED }),
    click('v-dup2', { fb_ad_id: `dup-2-${stamp}`, utm_term: SHARED }),
    // A name the click stream only ever saw on one id: resolvable even without fb_ad_id.
    click('v-solo-id', { fb_ad_id: `solo-1-${stamp}`, utm_term: SOLO }),
    click('v-solo-name', { utm_term: SOLO }),
    // A click carrying only the ambiguous name: must not be credited to either ad.
    click('v-ambiguous', { utm_term: SHARED }),
    // The only click that ever tied this name to an id, and it predates the window asked for.
    click('v-win-old', { fb_ad_id: `win-x-${stamp}`, utm_term: WINDOWED }, BEFORE_WINDOW),
    click('v-win-new', { utm_term: WINDOWED }),
    click('v-col-a', { fb_ad_id: `col-a-${stamp}`, utm_term: COLLIDING }),
    click('v-col-b', { fb_ad_id: `col-b-${stamp}`, utm_term: COLLIDING }),
  ])
  expect(clickError).toBeNull()
})

interface Row {
  ad_name: string
  clicks: number
  ad_spend: number | null
}

async function report(): Promise<Row[]> {
  const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
  expect(error).toBeNull()
  return (data as Row[]).filter((r) => r.clicks > 0)
}

describe('get_test_report_by_ad — identity is the ad id', () => {
  it('keeps two ads that share a name as two rows, each with its own spend', async () => {
    const withSpend = (await report()).filter((r) => r.ad_name.startsWith(SHARED) && Number(r.ad_spend ?? 0) > 0)
    expect(withSpend).toHaveLength(2)
    expect(withSpend.map((r) => Number(r.ad_spend)).sort((a, b) => a - b)).toEqual([60, 100])
  })

  it('tells the two apart by their adset, so the operator can act on either', async () => {
    const labels = (await report())
      .filter((r) => r.ad_name.startsWith(SHARED) && Number(r.ad_spend ?? 0) > 0)
      .map((r) => r.ad_name)
    expect(labels).toContain(`${SHARED} · Conjunto Alfa`)
    expect(labels).toContain(`${SHARED} · Conjunto Beta`)
  })

  it('resolves a name-only click when the click stream saw that name on exactly one ad', async () => {
    const solo = (await report()).filter((r) => r.ad_name.startsWith(SOLO))
    expect(solo).toHaveLength(1)
    expect(solo[0].clicks).toBe(2)
    expect(Number(solo[0].ad_spend)).toBe(25)
  })

  it('resolves a name using clicks from outside the report window', async () => {
    // Which ad a name belongs to is a fact about the account, not about the period on screen.
    // The only id-bearing click for this name predates p_since, and the spend table cannot help
    // (two ids share the name), so a window-filtered alias would drop the spend join entirely.
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', {
      p_test_id: testId,
      p_since: '2026-09-01T00:00:00Z',
      p_until: '2026-09-06T00:00:00Z',
    })
    expect(error).toBeNull()
    const row = (data as Row[]).find((r) => r.ad_name.startsWith(WINDOWED))
    expect(row).toBeDefined()
    expect(row!.ad_name).toBe(WINDOWED)
    expect(Number(row!.ad_spend)).toBe(77)
    // The window must still bound the clicks it counts -- only v-win-new falls inside it. Without
    // this, a "fix" that dropped the date filter from the click rows too would also report 77.
    expect(row!.clicks).toBe(1)
  })

  it('keeps two ads apart when even the label cascade runs out of tiebreakers', async () => {
    // Same name, adset, campaign and last-six-of-id, so both rows carry an identical label.
    // Grouping on the label alone would fuse them and max() would report one ad's spend as if
    // it were the pair's.
    const rows = (await report()).filter((r) => r.ad_name.startsWith(COLLIDING))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => Number(r.ad_spend)).sort((a, b) => a - b)).toEqual([20, 50])
    expect(new Set(rows.map((r) => r.ad_name)).size).toBe(1)
  })

  it('leaves an ambiguous name-only click unattributed rather than guessing an ad', async () => {
    const unresolved = (await report()).find((r) => r.ad_name === `${SHARED} · anúncio não identificado`)
    expect(unresolved).toBeDefined()
    expect(unresolved!.clicks).toBe(1)
    expect(Number(unresolved!.ad_spend ?? 0)).toBe(0)
  })
})
