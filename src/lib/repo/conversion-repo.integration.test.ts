import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClickEventByTrackingId, insertConversionIfNew } from './conversion-repo'

const db = createServiceRoleClient()
let clickEventId: string
let trackingId: string
let testSlug: string
let clientId: string

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
  clientId = client!.id

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
  testSlug = test!.slug
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
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

  it('includes the owning test slug, so callers can verify it matches the requested path', async () => {
    const result = await getClickEventByTrackingId(db, trackingId)
    expect(result?.testSlug).toBe(testSlug)
  })

  it('includes the owning client id, so per-client callers can verify ownership', async () => {
    const result = await getClickEventByTrackingId(db, trackingId)
    expect(result?.clientId).toBe(clientId)
  })

  it('returns null for an unknown tracking id', async () => {
    const result = await getClickEventByTrackingId(db, 'does-not-exist')
    expect(result).toBeNull()
  })

  it('inserts a conversion and reports duplicate on retry', async () => {
    const externalEventId = `inv_dup_${Date.now()}`
    const first = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId,
      valueCents: 5000,
    })
    expect(first).toBe('inserted')

    const second = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId,
      valueCents: 5000,
    })
    expect(second).toBe('duplicate')
  })

  // Migration 0050. Before it, this was the shape that silently dropped revenue: an upsell on
  // the same click hit unique (click_event_id, source) and the sale disappeared from every
  // report while the webhook answered 200.
  it('records a second purchase on the same click, as an upsell or a renewal produces', async () => {
    const stamp = Date.now()
    const principal = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId: `inv_principal_${stamp}`,
      valueCents: 9700,
    })
    const upsell = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId: `inv_upsell_${stamp}`,
      valueCents: 4700,
    })

    expect(principal).toBe('inserted')
    expect(upsell).toBe('inserted')
  })

  // The other half of the same change: freeing the click must not turn a redelivered webhook
  // into a second sale. The invoice is what stays unique.
  it('still absorbs a redelivered webhook, which carries the invoice it already sent', async () => {
    const externalEventId = `inv_redelivered_${Date.now()}`
    await insertConversionIfNew(db, { clickEventId, source: 'hubla_webhook', externalEventId, valueCents: 9700 })
    const again = await insertConversionIfNew(db, { clickEventId, source: 'hubla_webhook', externalEventId, valueCents: 9700 })

    expect(again).toBe('duplicate')
  })

  // The thank-you pixel has no invoice: it fires on every load of the page, so one per click is
  // the only thing keeping a browser refresh from becoming revenue.
  it('still counts the thank-you pixel once per click, however many times the page loads', async () => {
    const first = await insertConversionIfNew(db, { clickEventId, source: 'thank_you_page' })
    const reload = await insertConversionIfNew(db, { clickEventId, source: 'thank_you_page' })

    expect(first).toBe('inserted')
    expect(reload).toBe('duplicate')
  })
})
