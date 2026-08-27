import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { countRecentClickEventsByIp, getOrAssignVariant, getTestBySlug, insertClickEvent } from './redirect-repo'

const db = createServiceRoleClient()
let clientId: string
let testSlug: string
let testId: string
let variantId: string
let variantBId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `redirect-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'RepoTest', slug: `repo-test-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
  testSlug = `slug-${Date.now()}`

  const { data: test } = await db
    .from('tests')
    .insert({
      client_id: clientId,
      name: 'Repo Test',
      slug: testSlug,
      conversion_method: 'thank_you_page',
    })
    .select()
    .single()
  testId = test!.id

  const { data: variant } = await db
    .from('variants')
    .insert({
      test_id: test!.id,
      name: 'A',
      weight_pct: 50,
      destination_url: 'https://example.com/a',
    })
    .select()
    .single()
  variantId = variant!.id

  const { data: variantB } = await db
    .from('variants')
    .insert({
      test_id: test!.id,
      name: 'B',
      weight_pct: 50,
      destination_url: 'https://example.com/b',
    })
    .select()
    .single()
  variantBId = variantB!.id
})

describe('redirect-repo', () => {
  it('fetches an active test with its variants, ordered by name', async () => {
    const test = await getTestBySlug(db, testSlug)
    expect(test?.status).toBe('active')
    expect(test?.variants).toHaveLength(2)
    expect(test?.variants[0].destination_url).toBe('https://example.com/a')
    expect(test?.variants[1].destination_url).toBe('https://example.com/b')
  })

  it('returns null for an unknown slug', async () => {
    const test = await getTestBySlug(db, 'does-not-exist')
    expect(test).toBeNull()
  })

  it('inserts a click event', async () => {
    const trackingId = crypto.randomUUID()
    await insertClickEvent(db, {
      testId,
      variantId,
      visitorId: 'visitor-1',
      trackingId,
      sourceUtms: { utm_source: 'meta' },
    })
    const { data } = await db.from('click_events').select('*').eq('tracking_id', trackingId).single()
    expect(data?.visitor_id).toBe('visitor-1')
  })

  it('counts recent click events from the same ip, for rate limiting', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 255)}`
    for (let i = 0; i < 3; i++) {
      await insertClickEvent(db, {
        testId,
        variantId,
        visitorId: `visitor-ip-${i}`,
        trackingId: crypto.randomUUID(),
        sourceUtms: {},
        ip,
      })
    }
    const count = await countRecentClickEventsByIp(db, { testId, ip, sinceMinutes: 60 })
    expect(count).toBe(3)
  })

  it('does not count click events from a different ip', async () => {
    const count = await countRecentClickEventsByIp(db, {
      testId,
      ip: '198.51.100.1',
      sinceMinutes: 60,
    })
    expect(count).toBe(0)
  })

  it('resolves the same variant for concurrent first-time requests from the same visitor', async () => {
    const visitorId = `visitor-race-${Date.now()}`
    const [a, b] = await Promise.all([
      getOrAssignVariant(db, { testId, visitorId, candidateVariantId: variantId }),
      getOrAssignVariant(db, { testId, visitorId, candidateVariantId: variantBId }),
    ])
    expect(a).toBe(b)
    expect([variantId, variantBId]).toContain(a)
  })

  it('keeps returning the already-assigned variant on later calls', async () => {
    const visitorId = `visitor-stable-${Date.now()}`
    const first = await getOrAssignVariant(db, { testId, visitorId, candidateVariantId: variantId })
    const second = await getOrAssignVariant(db, { testId, visitorId, candidateVariantId: variantBId })
    expect(second).toBe(first)
  })
})
