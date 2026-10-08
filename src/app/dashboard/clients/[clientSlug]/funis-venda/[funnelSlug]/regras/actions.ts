'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Writes go through the user's session: the 0053 policies only let a gestor or owner of the
// project's client create fronts and rules, so no extra role check is needed here.

interface RulesContext {
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

function rulesPath(context: RulesContext): string {
  return `/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}/regras`
}

function back(context: RulesContext, param: 'ok' | 'erro', message: string): never {
  redirect(`${rulesPath(context)}?${param}=${encodeURIComponent(message)}`)
}

function databaseMessage(error: { code?: string; message: string }, duplicate: string): string {
  if (error.code === '23505') return duplicate
  if (error.code === '42501' || error.message.includes('row-level security')) return 'Só gestor ou owner pode alterar as regras.'
  return error.message
}

const frontSchema = z.object({
  code: z.string().trim().min(1, 'informe o código da frente').max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'informe o nome da frente').max(60),
  // Empty = the front owns campaigns through name rules; a project id = the front reads that project (0054).
  source_sales_funnel_id: z.union([z.literal(''), z.string().uuid()]).transform((value) => value || null),
})

export async function createFront(context: RulesContext, formData: FormData) {
  const result = frontSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    source_sales_funnel_id: formData.get('source_sales_funnel_id') ?? '',
  })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from('project_fronts')
    .select('id', { count: 'exact', head: true })
    .eq('sales_funnel_id', context.sales_funnel_id)
  const { error } = await supabase.from('project_fronts').insert({
    sales_funnel_id: context.sales_funnel_id,
    code: result.data.code,
    name: result.data.name,
    source_sales_funnel_id: result.data.source_sales_funnel_id,
    position: count ?? 0,
  })
  if (error) back(context, 'erro', databaseMessage(error, `Já existe uma frente ${result.data.code} neste projeto.`))
  revalidatePath(rulesPath(context))
  back(
    context,
    'ok',
    result.data.source_sales_funnel_id
      ? `Frente ${result.data.code} criada. Ela lê o outro projeto dentro da janela deste.`
      : `Frente ${result.data.code} criada. Agora adicione as regras de nome.`
  )
}

// Code and name only: a front's source decides who owns its campaigns, so changing it is remove and create.
export async function updateFront(context: RulesContext & { front_id: string }, formData: FormData) {
  const result = frontSchema.pick({ code: true, name: true }).safeParse({ code: formData.get('code'), name: formData.get('name') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('project_fronts')
    .update({ code: result.data.code, name: result.data.name })
    .eq('id', context.front_id)
    .select('id')
  if (error) back(context, 'erro', databaseMessage(error, `Já existe uma frente ${result.data.code} neste projeto.`))
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode editar frentes.')
  revalidatePath(rulesPath(context))
  back(context, 'ok', `Frente ${result.data.code} atualizada.`)
}

const pinSchema = z.object({ campaign_id: z.string().min(1), front_id: z.string().uuid('escolha a frente dona da campanha') })

// A pin by hand wins over the name rules and survives a rule change; the 0054 trigger refuses a
// front of another client or a front that only reads another project.
export async function pinCampaign(context: RulesContext & { client_id: string }, formData: FormData) {
  const result = pinSchema.safeParse({ campaign_id: formData.get('campaign_id'), front_id: formData.get('front_id') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('campaign_fronts').upsert(
    { client_id: context.client_id, campaign_id: result.data.campaign_id, front_id: result.data.front_id, source: 'manual', assigned_at: new Date().toISOString() },
    { onConflict: 'client_id,campaign_id' }
  )
  if (error) back(context, 'erro', databaseMessage(error, ''))
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Dono da campanha fixado. Renomear ou mudar regras não muda mais esta campanha.')
}

export async function unpinCampaign(context: RulesContext & { client_id: string; campaign_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaign_fronts')
    .delete()
    .eq('client_id', context.client_id)
    .eq('campaign_id', context.campaign_id)
    .select('campaign_id')
  if (error) back(context, 'erro', databaseMessage(error, ''))
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode soltar a campanha.')
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Campanha solta. Ela volta a seguir as regras de nome.')
}

export async function deleteFront(context: RulesContext & { front_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('project_fronts').delete().eq('id', context.front_id).select('id')
  if (error) back(context, 'erro', databaseMessage(error, ''))
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode remover frentes.')
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Frente removida.')
}

const ruleSchema = z.object({
  kind: z.enum(['include', 'exclude']),
  value: z.string().trim().min(1, 'informe o texto da regra').max(120),
})

export async function addRule(context: RulesContext & { front_id: string }, formData: FormData) {
  const result = ruleSchema.safeParse({ kind: formData.get('kind'), value: formData.get('value') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('naming_rules')
    .insert({ front_id: context.front_id, kind: result.data.kind, value: result.data.value })
  if (error) back(context, 'erro', databaseMessage(error, 'Essa regra já existe nesta frente.'))
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Regra adicionada.')
}

export async function removeRule(context: RulesContext & { rule_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('naming_rules').delete().eq('id', context.rule_id).select('id')
  if (error) back(context, 'erro', databaseMessage(error, ''))
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode remover regras.')
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Regra removida.')
}
