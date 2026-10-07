'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { COLUMNS, METHODS, RULE_LIMITS, STAGES, blockedMove, defaultGates, nextCode, type BacklogStatus, type Method, type TestRules } from '@/lib/domain/backlog'

// Writes go through the user's session: the 0068 policies only let a gestor or owner change the
// backlog. A write RLS refuses touches no row without raising, so every write selects what it
// changed and an empty result is reported as refused.

interface BacklogContext {
  client_id: string
  client_slug: string
  sales_funnel_id: string
  funnel_slug: string
}

function boardPath(context: BacklogContext, extra = ''): string {
  return `/dashboard/clients/${context.client_slug}/backlog?projeto=${context.funnel_slug}${extra}`
}

function back(context: BacklogContext, param: 'ok' | 'erro', message: string, extra = ''): never {
  redirect(`${boardPath(context, extra)}&${param}=${encodeURIComponent(message)}`)
}

const score = z.coerce.number().int().min(1).max(10)
const itemSchema = z.object({
  title: z.string().trim().min(1, 'dê um título para a hipótese').max(120),
  hypothesis: z.string().trim().max(1000),
  stage: z.enum(Object.keys(STAGES) as [keyof typeof STAGES, ...(keyof typeof STAGES)[]]),
  method: z.enum(Object.keys(METHODS) as [Method, ...Method[]]),
  impact: score,
  confidence: score,
  ease: score,
  metric: z.string().trim().max(120),
  owner: z.string().trim().max(60),
  variants: z.string(),
})

export async function createItem(context: BacklogContext, formData: FormData) {
  const result = itemSchema.safeParse({
    title: formData.get('title'),
    hypothesis: formData.get('hypothesis') ?? '',
    stage: formData.get('stage'),
    method: formData.get('method'),
    impact: formData.get('impact'),
    confidence: formData.get('confidence'),
    ease: formData.get('ease'),
    metric: formData.get('metric') ?? '',
    owner: formData.get('owner') ?? '',
    variants: formData.get('variants') ?? '',
  })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '), '&nova=1')
  const names = result.data.variants.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, 26)
  if (names.length < 2) back(context, 'erro', 'Liste pelo menos duas variantes, uma por linha (a primeira é o controle).', '&nova=1')

  const supabase = await createServerSupabaseClient()
  const { data: codes } = await supabase.from('backlog_items').select('code').eq('sales_funnel_id', context.sales_funnel_id)
  const code = nextCode((codes ?? []).map((row) => row.code as string))
  const { data: item, error } = await supabase
    .from('backlog_items')
    .insert({
      client_id: context.client_id,
      sales_funnel_id: context.sales_funnel_id,
      code,
      title: result.data.title,
      hypothesis: result.data.hypothesis,
      stage: result.data.stage,
      method: result.data.method,
      impact: result.data.impact,
      confidence: result.data.confidence,
      ease: result.data.ease,
      metric: result.data.metric,
      owner: result.data.owner || null,
    })
    .select('id')
    .single()
  if (error) back(context, 'erro', error.code === '42501' ? 'Só gestor ou owner pode criar hipóteses.' : error.message, '&nova=1')
  const { error: childError } = await supabase.from('backlog_variants').insert(
    names.map((name, index) => ({ item_id: item.id, client_id: context.client_id, key: String.fromCharCode(65 + index), name, position: index }))
  )
  if (childError) back(context, 'erro', childError.message)
  const { error: gateError } = await supabase.from('backlog_gates').insert(
    defaultGates(result.data.method, code).map((label, index) => ({ item_id: item.id, client_id: context.client_id, label, position: index }))
  )
  if (gateError) back(context, 'erro', gateError.message)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${code} entrou na fila.`, `&item=${code}`)
}

export async function moveItem(context: BacklogContext & { item_id: string; code: string }, formData: FormData) {
  const to = formData.get('to') as BacklogStatus
  if (!COLUMNS.some((column) => column.status === to)) back(context, 'erro', 'Coluna inválida.')
  const supabase = await createServerSupabaseClient()
  const { data: item, error: readError } = await supabase
    .from('backlog_items')
    .select('learning, started_at, backlog_gates(done_at)')
    .eq('id', context.item_id)
    .maybeSingle()
  if (readError || !item) back(context, 'erro', 'Não foi possível ler o teste para movê-lo.', `&item=${context.code}`)
  const gatesOpen = ((item?.backlog_gates ?? []) as { done_at: string | null }[]).filter((gate) => !gate.done_at).length
  const blocked = blockedMove(to, { gatesOpen, hasLearning: Boolean(item?.learning) })
  if (blocked) back(context, 'erro', blocked, `&item=${context.code}`)
  // Leaving Rodando clears the start, so a test that goes live again is measured from the new start.
  const { data: moved, error } = await supabase
    .from('backlog_items')
    .update({ status: to, started_at: to === 'running' ? (item.started_at ?? new Date().toISOString()) : null })
    .eq('id', context.item_id)
    .select('id')
  if (error || !moved?.length) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode mover hipóteses.', `&item=${context.code}`)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${context.code} foi para ${COLUMNS.find((column) => column.status === to)!.label}.`, `&item=${context.code}`)
}

export async function toggleGate(context: BacklogContext & { gate_id: string; done: boolean; code: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('backlog_gates')
    .update({ done_at: context.done ? new Date().toISOString() : null })
    .eq('id', context.gate_id)
    .select('id')
  if (error || !data?.length) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode marcar pré-requisitos.', `&item=${context.code}`)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  redirect(boardPath(context, `&item=${context.code}`))
}

const decisionSchema = z.object({
  winner_key: z.string().regex(/^[A-Z]$/).or(z.literal('')),
  result: z.string().trim().max(300),
  learning: z.string().trim().min(10, 'escreva o aprendizado: o que este teste ensinou (pelo menos uma frase)').max(1000),
})

export async function decideItem(context: BacklogContext & { item_id: string; code: string }, formData: FormData) {
  const parsed = decisionSchema.safeParse({
    winner_key: formData.get('winner_key') ?? '',
    result: formData.get('result') ?? '',
    learning: formData.get('learning') ?? '',
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '), `&item=${context.code}`)
  const supabase = await createServerSupabaseClient()
  const winnerKey = parsed.data.winner_key || null
  if (winnerKey) {
    const { data: variant } = await supabase.from('backlog_variants').select('id').eq('item_id', context.item_id).eq('key', winnerKey).maybeSingle()
    if (!variant) back(context, 'erro', `A variante ${winnerKey} não existe neste teste.`, `&item=${context.code}`)
  }
  const { data: decided, error } = await supabase
    .from('backlog_items')
    .update({
      status: 'decided',
      decided_at: new Date().toISOString(),
      winner_key: winnerKey,
      result: parsed.data.result || null,
      learning: parsed.data.learning,
    })
    .eq('id', context.item_id)
    .select('id')
  if (error || !decided?.length) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode decidir testes.', `&item=${context.code}`)
  const { error: resetError } = await supabase.from('backlog_variants').update({ status: 'active' }).eq('item_id', context.item_id).eq('status', 'winner')
  if (resetError) back(context, 'erro', resetError.message, `&item=${context.code}`)
  if (winnerKey) {
    const { error: winnerError } = await supabase.from('backlog_variants').update({ status: 'winner' }).eq('item_id', context.item_id).eq('key', winnerKey)
    if (winnerError) back(context, 'erro', winnerError.message, `&item=${context.code}`)
  }
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${context.code} decidido. O aprendizado fica no card.`, `&item=${context.code}`)
}

export async function togglePublished(context: BacklogContext & { item_id: string; code: string; published: boolean }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('backlog_items').update({ published: context.published }).eq('id', context.item_id).select('id')
  if (error || !data?.length) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode publicar para o cliente.', `&item=${context.code}`)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', context.published ? `${context.code} aparece para o cliente quando estiver rodando ou decidido.` : `${context.code} saiu da visão do cliente.`, `&item=${context.code}`)
}

export async function linkAbTest(context: BacklogContext & { item_id: string; code: string }, formData: FormData) {
  const testId = String(formData.get('ab_test_id') ?? '')
  const supabase = await createServerSupabaseClient()
  if (testId) {
    const { data: test } = await supabase.from('tests').select('id').eq('id', testId).eq('client_id', context.client_id).maybeSingle()
    if (!test) back(context, 'erro', 'Teste A/B não encontrado neste cliente.', `&item=${context.code}`)
  }
  const { data, error } = await supabase.from('backlog_items').update({ ab_test_id: testId || null }).eq('id', context.item_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode vincular o teste A/B.', `&item=${context.code}`)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', testId ? `${context.code} agora é medido pelo teste A/B vinculado.` : `${context.code} ficou sem teste A/B vinculado.`, `&item=${context.code}`)
}

export async function deleteItem(context: BacklogContext & { item_id: string; code: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('backlog_items').delete().eq('id', context.item_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode excluir hipóteses.', `&item=${context.code}`)
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${context.code} saiu do backlog.`)
}

export async function saveRules(context: BacklogContext, formData: FormData) {
  const rules = {} as TestRules
  for (const key of Object.keys(RULE_LIMITS) as (keyof TestRules)[]) {
    const value = Number(String(formData.get(key) ?? '').replace(',', '.'))
    const [min, max, integer] = RULE_LIMITS[key]
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      back(context, 'erro', `Valor fora do intervalo em "${key}": use de ${min} a ${max}${integer ? ', número inteiro' : ''}.`, '&aba=regras')
    }
    rules[key] = value
  }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('sales_funnels').update({ test_rules: rules }).eq('id', context.sales_funnel_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode mudar as regras do jogo.', '&aba=regras')
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', 'Regras do jogo salvas.', '&aba=regras')
}
