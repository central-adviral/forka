import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getTestBySlug, insertClickEvent } from './redirect-repo'

const db = createServiceRoleClient()
let clientId: string
let testSlug: string
let variantId: string

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

  const { data: variant } = await db
    .from('variants')
    .insert({
      test_id: test!.id,
      name: 'A',
      weight_pct: 100,
      destination_url: 'https://example.com/a',
    })
    .select()
    .single()

  variantId = variant!.id
})

describe('redirect-repo', () => {
  it('fetches an active test with its variants', async () => {
    const test = await getTestBySlug(db, testSlug)
    expect(test?.status).toBe('active')
    expect(test?.variants).toHaveLength(1)
    expect(test?.variants[0].destination_url).toBe('https://example.com/a')
  })

  it('returns null for an unknown slug', async () => {
    const test = await getTestBySlug(db, 'does-not-exist')
    expect(test).toBeNull()
  })

  it('inserts a click event', async () => {
    const trackingId = crypto.randomUUID()
    await insertClickEvent(db, {
      testId: (await getTestBySlug(db, testSlug))!.id,
      variantId,
      visitorId: 'visitor-1',
      trackingId,
      sourceUtms: { utm_source: 'meta' },
    })
    const { data } = await db.from('click_events').select('*').eq('tracking_id', trackingId).single()
    expect(data?.visitor_id).toBe('visitor-1')
  })
})
