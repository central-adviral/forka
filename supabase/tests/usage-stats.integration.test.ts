import { describe, it, expect } from 'vitest'
import { createClient, type PostgrestError } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

describe('get_usage_stats', () => {
  it('counts only rows owned by the calling user', async () => {
    const email = `usage-stats-${Date.now()}@example.com`
    const { data: authUser } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const asOwner = createClient(URL, ANON_KEY)
    await asOwner.auth.signInWithPassword({ email, password: 'password123' })

    await admin.from('clients').insert({ owner_id: authUser!.user!.id, name: 'Usage Test', slug: `usage-${Date.now()}` })

    const { data, error } = (await asOwner.rpc('get_usage_stats').single()) as {
      data: { total_clients: number } | null
      error: PostgrestError | null
    }
    expect(error).toBeNull()
    expect(data!.total_clients).toBeGreaterThanOrEqual(1)
  })
})
