import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getProjectSetupStatus } from '@/lib/repo/project-setup-repo'
import { saveClientSecrets } from '@/lib/repo/client-secrets-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('getProjectSetupStatus against the database', () => {
  it('reads the five facts on the owner session and counts rules through the project fronts only', async () => {
    const email = `setup-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Setup', slug: `setup-${Date.now()}`, funnel_source_url: 'https://launchops.example.com' })
      .select()
      .single()
    const { data: projects } = await admin
      .from('sales_funnels')
      .insert([
        { client_id: client!.id, name: 'Perpétuo', slug: 'perpetuo' },
        { client_id: client!.id, name: 'Outro', slug: 'outro' },
      ])
      .select()
    const project = projects!.find((row) => row.slug === 'perpetuo')!
    const other = projects!.find((row) => row.slug === 'outro')!

    // Nothing set yet: 0/5 (resultado has a default, but there is no cost target).
    const empty = await getProjectSetupStatus(owner, admin, client!.id, project.id)
    expect(empty!.done).toBe(0)

    await saveClientSecrets(admin, client!.id, { funnelSourceServiceRoleKey: 'k', hublaWebhookToken: 't' })
    await admin.from('project_products').insert({ sales_funnel_id: project.id, produto_nome: 'Curso', papel: 'entrada' })
    const { data: fronts } = await admin
      .from('project_fronts')
      .insert([
        { sales_funnel_id: project.id, code: 'P', name: 'Paga' },
        { sales_funnel_id: other.id, code: 'O', name: 'Outra' },
      ])
      .select()
    // A rule on the other project's front must not count for this one.
    await admin.from('naming_rules').insert({ front_id: fronts!.find((row) => row.sales_funnel_id === other.id)!.id, kind: 'include', value: 'OUTRO' })
    const withoutOwnRule = await getProjectSetupStatus(owner, admin, client!.id, project.id)
    expect(withoutOwnRule!.steps.find((step) => step.id === 'regras')!.done).toBe(false)

    await admin.from('naming_rules').insert({ front_id: fronts!.find((row) => row.sales_funnel_id === project.id)!.id, kind: 'include', value: 'PERP' })
    await admin.from('watchers').insert([
      { client_id: client!.id, sales_funnel_id: project.id, metric: 'cpa_geral', target: 60 },
      { client_id: client!.id, sales_funnel_id: project.id, metric: 'ctr', target: 1.2 },
    ])
    const ready = await getProjectSetupStatus(owner, admin, client!.id, project.id)
    expect(ready!.steps.map((step) => [step.id, step.done])).toEqual([
      ['integracoes', true],
      ['produtos', true],
      ['regras', true],
      ['plano', true],
      ['metas', true],
    ])
    expect(ready!.done).toBe(5)
  })
})
