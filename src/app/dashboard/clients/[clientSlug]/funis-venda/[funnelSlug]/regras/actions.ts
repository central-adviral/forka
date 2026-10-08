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

// changed = a naming rule was saved, so the page offers "Aplicar desde".
function back(context: RulesContext, param: 'ok' | 'erro', message: string, changed = false): never {
  redirect(`${rulesPath(context)}?${param}=${encodeURIComponent(message)}${changed ? '&mudou=1' : ''}`)
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
  if (error) back(context, 'erro', databaseMessage(error, `Já existe uma frente ${result.data.code} neste projeto (veja também as arquivadas).`))
  revalidatePath(rulesPath(context))
  back(
    context,
    'ok',
    result.data.source_sales_funnel_id
      ? `Frente ${result.data.code} criada. Ela lê o outro projeto dentro da janela deste.`
      : `Frente ${result.data.code} criada. Agora adicione as regras de nome.`
  )
}

const frontMetric = z.union([z.literal(''), z.enum(['compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'])]).transform((value) => value || null)
const frontTarget = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value.replace(/\./g, '').replace(',', '.'))))
  .refine((value) => value === null || (Number.isFinite(value) && value > 0), 'o alvo da frente é um número maior que zero')

// Code, name and the front's own metrics (0102); a trigger keeps the front's watchers in step. The
// source decides who owns its campaigns, so changing it is remove and create.
const updateFrontSchema = frontSchema
  .pick({ code: true, name: true })
  .extend({ metrica_principal: frontMetric, alvo_principal: frontTarget, metrica_secundaria: frontMetric, alvo_secundaria: frontTarget })
  .refine((value) => !value.metrica_secundaria || value.metrica_principal, 'escolha a métrica principal da frente antes da secundária')
  .refine((value) => !value.metrica_secundaria || value.metrica_secundaria !== value.metrica_principal, 'a métrica secundária precisa ser diferente da principal')

export async function updateFront(context: RulesContext & { front_id: string }, formData: FormData) {
  const text = (name: string) => String(formData.get(name) ?? '')
  const result = updateFrontSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    metrica_principal: text('metrica_principal'),
    alvo_principal: text('alvo_principal'),
    metrica_secundaria: text('metrica_secundaria'),
    alvo_secundaria: text('alvo_secundaria'),
  })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('project_fronts')
    .update(result.data)
    .eq('id', context.front_id)
    .select('id')
  if (error) back(context, 'erro', databaseMessage(error, `Já existe uma frente ${result.data.code} neste projeto (veja também as arquivadas).`))
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

// Archive, never delete: the front keeps the campaigns it owns and their history, and claims no new one (0100).
export async function setFrontArchived(context: RulesContext & { front_id: string; code: string }, archived: boolean) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc('set_front_archived', { p_front_id: context.front_id, p_archived: archived })
  if (error) back(context, 'erro', error.message.includes('access denied') ? 'Só gestor ou owner pode arquivar frentes.' : error.message)
  revalidatePath(`/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}`, 'layout')
  back(
    context,
    'ok',
    archived
      ? `Frente ${context.code} arquivada. As campanhas dela continuam no histórico; campanhas novas não entram mais nela.`
      : `Frente ${context.code} restaurada.`
  )
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
  back(context, 'ok', 'Regra adicionada. Campanhas que já gastaram ficam com o dono que têm; a regra decide as novas.', true)
}

export interface RulePreview {
  text: string | null
  error: string | null
}

/** What the rule would take before it is saved (0092, 0101): unowned campaigns of the last 30 days, spend, disputes. */
export async function previewRule(context: RulesContext & { front_id: string }, _previous: RulePreview | null, formData: FormData): Promise<RulePreview> {
  const result = ruleSchema.safeParse({ kind: formData.get('kind'), value: formData.get('value') })
  if (!result.success) return { text: null, error: result.error.issues.map((issue) => issue.message).join('; ') }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('preview_naming_rule', { p_front_id: context.front_id, p_kind: result.data.kind, p_value: result.data.value })
  if (error) return { text: null, error: error.message.includes('access denied') ? 'Só gestor ou owner pode prever regras.' : error.message }
  const row = (data as { campaigns: number; spend: number; disputed: number; kept_by_others: number }[])[0]
  const campaigns = Number(row.campaigns)
  const spend = Number(row.spend).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
  const parts = [
    campaigns === 0 ? 'Com esta regra a frente não pega nenhuma campanha sem dono dos últimos 30 dias.' : `Com esta regra a frente pega ${campaigns} ${campaigns === 1 ? 'campanha sem dono' : 'campanhas sem dono'} dos últimos 30 dias, ${spend}.`,
    Number(row.disputed) > 0 ? `${row.disputed} passa${Number(row.disputed) === 1 ? '' : 'm'} a bater também em outra frente e fica${Number(row.disputed) === 1 ? '' : 'm'} em disputa.` : null,
    Number(row.kept_by_others) > 0 ? `${row.kept_by_others} ${Number(row.kept_by_others) === 1 ? 'casa' : 'casam'} com a regra mas já ${Number(row.kept_by_others) === 1 ? 'tem' : 'têm'} dono e ${Number(row.kept_by_others) === 1 ? 'fica' : 'ficam'} com ele (use Aplicar desde para refazer o passado).` : null,
    'Campanhas que já gastaram ficam com o dono que têm.',
  ]
  return { text: parts.filter(Boolean).join(' '), error: null }
}

// naming_rules has no update policy (0053), so an edit adds the new rule and then removes the old
// one: the same two steps a gestor would take by hand, in the order that loses nothing if the
// new rule is refused (a duplicate, a missing role).
export async function updateRule(context: RulesContext & { front_id: string; rule_id: string }, formData: FormData) {
  const result = ruleSchema.safeParse({ kind: formData.get('kind'), value: formData.get('value') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { data: current } = await supabase.from('naming_rules').select('kind, value').eq('id', context.rule_id).maybeSingle()
  if (!current) back(context, 'erro', 'Regra não encontrada.')
  if (current.kind === result.data.kind && current.value === result.data.value) back(context, 'ok', 'Nada mudou na regra.')
  const { data: added, error } = await supabase
    .from('naming_rules')
    .insert({ front_id: context.front_id, kind: result.data.kind, value: result.data.value })
    .select('id')
  if (error) back(context, 'erro', databaseMessage(error, 'Essa regra já existe nesta frente.'))
  if (!added?.length) back(context, 'erro', 'Só gestor ou owner pode alterar as regras.')
  const { error: removeError } = await supabase.from('naming_rules').delete().eq('id', context.rule_id)
  if (removeError) back(context, 'erro', databaseMessage(removeError, ''))
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Regra alterada. Campanhas que já gastaram ficam com o dono que têm; a regra decide as novas.', true)
}

export async function removeRule(context: RulesContext & { rule_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('naming_rules').delete().eq('id', context.rule_id).select('id')
  if (error) back(context, 'erro', databaseMessage(error, ''))
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode remover regras.')
  revalidatePath(rulesPath(context))
  back(context, 'ok', 'Regra removida. Campanhas que já gastaram ficam com o dono que têm; a mudança decide as novas.', true)
}
