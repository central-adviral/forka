import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `weekday-hour-report-${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

// Independently computes the same America/Sao_Paulo weekday/hour bucketing the RPCs use,
// via Node's built-in Intl API, so the test doesn't rely on hand-calculated day-of-week math.
function expectedBucket(instantIso: string): { weekday: number; hour: number } {
  const date = new Date(instantIso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date)
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekday = weekdayNames.indexOf(parts.find((p) => p.type === 'weekday')!.value)
  const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24
  return { weekday, hour }
}

describe('get_test_report_by_weekday and get_test_report_by_hour', () => {
  it('buckets a click into the correct America/Sao_Paulo weekday and hour, always returning all 7/24 buckets', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Weekday Hour Test', slug: `weekday-hour-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Dia/Hora',
        slug: `teste-dia-hora-${Date.now()}`,
        conversion_method: 'thank_you_page',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()

    const instant = '2026-08-31T15:00:00.000Z'
    const { weekday, hour } = expectedBucket(instant)

    const { data: click } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: 'v1',
        tracking_id: crypto.randomUUID(),
        source_utms: {},
      })
      .select()
      .single()
    await admin.from('click_events').update({ created_at: instant }).eq('id', click!.id)
    await admin.from('conversions').insert({ click_event_id: click!.id, source: 'thank_you_page', value_cents: 500 })

    const { data: weekdayReport, error: weekdayError } = await asOwner.rpc('get_test_report_by_weekday', {
      p_test_id: test!.id,
    })
    expect(weekdayError).toBeNull()
    expect(weekdayReport).toHaveLength(7)
    const weekdayRow = weekdayReport!.find((r: { weekday: number }) => r.weekday === weekday)
    expect(weekdayRow).toMatchObject({ clicks: 1, conversions: 1, revenue_cents: 500 })
    const otherWeekdayRows = weekdayReport!.filter((r: { weekday: number }) => r.weekday !== weekday)
    expect(otherWeekdayRows.every((r: { clicks: number }) => r.clicks === 0)).toBe(true)

    const { data: hourReport, error: hourError } = await asOwner.rpc('get_test_report_by_hour', {
      p_test_id: test!.id,
    })
    expect(hourError).toBeNull()
    expect(hourReport).toHaveLength(24)
    const hourRow = hourReport!.find((r: { hour: number }) => r.hour === hour)
    expect(hourRow).toMatchObject({ clicks: 1, conversions: 1, revenue_cents: 500 })
  })
})
