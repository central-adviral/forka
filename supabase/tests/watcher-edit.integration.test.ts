import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function signedIn(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

// Editing a watcher in Metas runs on the user's session: these are the writes updateWatcher makes.
describe('editing a watcher from Metas', () => {
  it('lets a gestor change a watcher and a front target, and refuses a cliente member', async () => {
    const owner = await signedIn('edit-owner')
    const cliente = await signedIn('edit-cliente')
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Edit', slug: `edit-${Date.now()}` }).select().single()
    await admin.from('memberships').insert({ client_id: client!.id, user_id: cliente.userId, role: 'cliente' })
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const { data: front } = await admin
      .from('project_fronts')
      .insert({ sales_funnel_id: funnel!.id, code: 'CAP', name: 'Captação', metrica_principal: 'lead', alvo_principal: 5 })
      .select()
      .single()
    const { data: free } = await admin
      .from('watchers')
      .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, metric: 'cpm', target: 20, last_status: 'crit', last_value: 40 })
      .select()
      .single()

    const refused = await cliente.db.from('watchers').update({ target: 99 }).eq('id', free!.id).select('id')
    expect(refused.data ?? []).toEqual([])

    const saved = await owner.db
      .from('watchers')
      .update({ front_id: front!.id, metric: 'ctr', target: 1.5, warn_pct: 10, crit_pct: 25, last_value: null, last_status: null })
      .eq('id', free!.id)
      .select('front_id, metric, target, warn_pct, crit_pct, last_status')
      .single()
    expect(saved.error).toBeNull()
    expect(saved.data).toMatchObject({ front_id: front!.id, metric: 'ctr', target: 1.5, warn_pct: 10, crit_pct: 25, last_status: null })

    // The 0086 rule holds on an edit too: no CPA geral on a front.
    expect((await owner.db.from('watchers').update({ metric: 'cpa_geral' }).eq('id', free!.id).select('id')).error).not.toBeNull()

    // A front watcher: the target goes on the front and the 0102 trigger copies it; the band stays on the watcher.
    const frontWatcher = (await admin.from('watchers').select('id').eq('front_id', front!.id).eq('plan_role', 'principal').single()).data!
    expect((await owner.db.from('project_fronts').update({ alvo_principal: 7 }).eq('id', front!.id).select('id')).data).toHaveLength(1)
    await owner.db.from('watchers').update({ warn_pct: 5, crit_pct: 15 }).eq('id', frontWatcher.id)
    const { data: followed } = await admin.from('watchers').select('metric, target, warn_pct, crit_pct').eq('id', frontWatcher.id).single()
    expect(followed).toMatchObject({ metric: 'cpl', target: 7, warn_pct: 5, crit_pct: 15 })

    expect((await cliente.db.from('project_fronts').update({ alvo_principal: 1 }).eq('id', front!.id).select('id')).data ?? []).toEqual([])
  })
})
