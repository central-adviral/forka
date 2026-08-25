import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClickEventByTrackingId, insertConversionIfNew } from './conversion-repo'

const db = createServiceRoleClient()
let clickEventId: string
let trackingId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `conv-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'ConvRepo', slug: `conv-repo-${Date.now()}` })
    .select()
    .single()

  // Seeded via direct service-role inserts, not the create_test_with_variants RPC —
  // same reasoning as Task 5: that RPC requires an authenticated-user auth.uid(),
  // which a service-role client does not have.
  const { data: test } = await db
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Conv Test',
      slug: `conv-slug-${Date.now()}`,
      conversion_method: 'hubla_webhook',
    })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  trackingId = crypto.randomUUID()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'visitor-x',
      tracking_id: trackingId,
      source_utms: {},
    })
    .select()
    .single()
  clickEventId = clickEvent!.id
})

describe('conversion-repo', () => {
  it('finds a click event by tracking id', async () => {
    const result = await getClickEventByTrackingId(db, trackingId)
    expect(result?.id).toBe(clickEventId)
  })

  it('returns null for an unknown tracking id', async () => {
    const result = await getClickEventByTrackingId(db, 'does-not-exist')
    expect(result).toBeNull()
  })

  it('inserts a conversion and reports duplicate on retry', async () => {
    const first = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId: 'inv_dup_1',
      valueCents: 5000,
    })
    expect(first).toBe('inserted')

    const second = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId: 'inv_dup_1',
      valueCents: 5000,
    })
    expect(second).toBe('duplicate')
  })
})
