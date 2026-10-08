import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { purgeOldClickIps } from '@/lib/repo/redirect-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('click IP retention', () => {
  it('clears the IP of clicks older than 30 days and keeps the recent ones the rate limit needs', async () => {
    const email = `ip-retention-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'IP Retention', slug: `ip-retention-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({ client_id: client!.id, name: 'ip', slug: `ip-${Date.now()}`, conversion_method: 'thank_you_page' })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
      .select()
      .single()
    const click = (createdAt: string) => ({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: crypto.randomUUID(),
      tracking_id: crypto.randomUUID(),
      ip: '203.0.113.7',
      created_at: createdAt,
    })
    const now = new Date('2026-10-07T12:00:00Z')
    const { error } = await admin.from('click_events').insert([click('2026-09-01T12:00:00Z'), click('2026-10-01T12:00:00Z')])
    expect(error).toBeNull()

    await purgeOldClickIps(admin, now)

    const { data: rows } = await admin.from('click_events').select('created_at, ip').eq('test_id', test!.id).order('created_at')
    expect(rows!.map((row) => row.ip)).toEqual([null, '203.0.113.7'])
  })
})
