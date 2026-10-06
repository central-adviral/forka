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
})

export async function createFront(context: RulesContext, formData: FormData) {
  const result = frontSchema.safeParse({ code: formData.get('code'), name: formData.get('name') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from('project_fronts')
    .select('id', { count: 'exact', head: true })
    .eq('sales_funnel_id', context.sales_funnel_id)
  const { error } = await supabase
    .from('project_fronts')
    .insert({ sales_funnel_id: context.sales_funnel_id, code: result.data.code, name: result.data.name, position: count ?? 0 })
  if (error) back(context, 'erro', databaseMessage(error, `Já existe uma frente ${result.data.code} neste projeto.`))
  revalidatePath(rulesPath(context))
  back(context, 'ok', `Frente ${result.data.code} criada. Agora adicione as regras de nome.`)
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
