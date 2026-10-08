'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { AUTO_LINK_GATE, COLUMNS, isAutoTagGate, METHODS, RULE_LIMITS, STAGES, blockedMove, defaultGates, nextCode, type BacklogStatus, type Method, type TestRules } from '@/lib/domain/backlog'
import { matchTestVariant } from '@/lib/domain/experiment-decision'
import { equalWeights, experimentSlug, experimentVariantName } from '@/lib/domain/experiment-link'
import { findTaggedCards } from '@/lib/repo/backlog-readout-repo'
import { httpUrl } from '@/lib/domain/http-url-schema'

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

  // A link hypothesis can create its A/B test right away: the variants are typed once, here. Checked
  // before anything is written, so a bad link returns to the form with the draft.
  const link = result.data.method === 'link' && formData.get('create_link') === 'on' ? readLinkFields(formData, names) : null
  if (link && 'error' in link) back(context, 'erro', link.error, '&nova=1')

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
  let linkNote = ''
  if (link && !('error' in link)) {
    const created = await createExperimentTest(supabase, context, { itemId: item.id, code, title: result.data.title, names, ...link })
    // "Criar e gerar o link" ends where the next step is: the link to paste in the ads.
    if (created.ok) {
      revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
      redirect(`/dashboard/clients/${context.client_slug}/tests/${created.slug}/link`)
    }
    linkNote = ` O link não foi criado: ${created.error} Crie em Testes › A/B de link e vincule no card.`
  }
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${code} entrou na fila.${linkNote}`, `&item=${code}`)
}

interface LinkFields {
  testType: 'page' | 'checkout'
  salesPageUrl: string | null
  conversionMethod: 'hubla_webhook' | 'thank_you_page'
  urls: string[]
}

function readLinkFields(formData: FormData, names: string[]): LinkFields | { error: string } {
  const testType = formData.get('test_type') === 'checkout' ? 'checkout' : 'page'
  const conversionMethod = formData.get('conversion_method') === 'thank_you_page' ? 'thank_you_page' : 'hubla_webhook'
  const salesPage = String(formData.get('sales_page_url') ?? '').trim()
  if (testType === 'checkout' && !httpUrl.safeParse(salesPage).success) return { error: 'Teste de checkout: informe a URL da página de vendas (com https://).' }
  const urls = names.map((_, index) => String(formData.get(`url_${index}`) ?? '').trim())
  const missing = urls.findIndex((url) => !httpUrl.safeParse(url).success)
  if (missing >= 0) {
    return { error: `Falta o link da variante ${String.fromCharCode(65 + missing)} (${names[missing]}): use um endereço com https://.` }
  }
  return { testType, salesPageUrl: testType === 'checkout' ? salesPage : null, conversionMethod, urls }
}

/**
 * Creates the card's A/B test in its project, paused until the card runs, links it to the card and
 * checks the "Link /r criado" gate.
 */
async function createExperimentTest(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  context: BacklogContext,
  input: LinkFields & { itemId: string; code: string; title: string; names: string[] }
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const weights = equalWeights(input.names.length)
  const base = experimentSlug(input.code, input.title)
  let testId: string | null = null
  let testSlug = base
  for (const slug of [base, `${base}-${Math.random().toString(36).slice(2, 6)}`]) {
    const { data, error } = await supabase.rpc('create_test_with_variants', {
      p_client_id: context.client_id,
      p_name: `${input.code} · ${input.title}`,
      p_slug: slug,
      p_fallback_url: null,
      p_conversion_method: input.conversionMethod,
      p_test_type: input.testType,
      p_sales_page_url: input.salesPageUrl,
      p_variants: input.names.map((name, index) => ({
        name: experimentVariantName(String.fromCharCode(65 + index), name),
        weight_pct: weights[index],
        destination_url: input.urls[index],
        thank_you_url: null,
      })),
    })
    if (!error) {
      testId = data as string
      testSlug = slug
      break
    }
    // Only a taken slug is worth a second try with a suffix; anything else is the answer.
    if (error.code !== '23505') return { ok: false, error: 'o teste A/B foi recusado.' }
  }
  if (!testId) return { ok: false, error: 'o endereço do link já está em uso.' }

  const { error: placeError } = await supabase.from('tests').update({ status: 'paused', sales_funnel_id: context.sales_funnel_id }).eq('id', testId)
  if (placeError) return { ok: false, error: 'o teste foi criado, mas não entrou no projeto.' }
  const { error: linkError } = await supabase.from('backlog_items').update({ ab_test_id: testId }).eq('id', input.itemId)
  if (linkError) return { ok: false, error: 'o teste foi criado, mas não ficou vinculado ao card.' }
  await supabase.from('backlog_gates').update({ done_at: new Date().toISOString() }).eq('item_id', input.itemId).eq('label', AUTO_LINK_GATE)
  return { ok: true, slug: testSlug }
}

export async function moveItem(context: BacklogContext & { item_id: string; code: string }, formData: FormData) {
  const to = formData.get('to') as BacklogStatus
  if (!COLUMNS.some((column) => column.status === to)) back(context, 'erro', 'Coluna inválida.')
  const supabase = await createServerSupabaseClient()
  const { data: item, error: readError } = await supabase
    .from('backlog_items')
    .select('learning, started_at, status, ab_test_id, method, code, backlog_gates(id, label, done_at)')
    .eq('id', context.item_id)
    .maybeSingle()
  if (readError || !item) back(context, 'erro', 'Não foi possível ler o teste para movê-lo.', `&item=${context.code}`)
  // The Meta tag gate is a fact the Central reads: an ad with the card's tag spent in the last days.
  const gates = (item?.backlog_gates ?? []) as { id: string; label: string; done_at: string | null }[]
  const tagGate = item?.method === 'meta' ? gates.find((gate) => isAutoTagGate(gate.label) && !gate.done_at) : undefined
  if (tagGate && (await findTaggedCards(supabase, context.sales_funnel_id, [item!.code])).size > 0) {
    await supabase.from('backlog_gates').update({ done_at: new Date().toISOString() }).eq('id', tagGate.id)
    tagGate.done_at = new Date().toISOString()
  }
  const gatesOpen = gates.filter((gate) => !gate.done_at).length
  const blocked = blockedMove(to, { gatesOpen, hasLearning: Boolean(item?.learning) })
  if (blocked) back(context, 'erro', blocked, `&item=${context.code}`)
  // The card drives its A/B test: Rodando turns the link on, leaving Rodando parks it on the control.
  if (item.ab_test_id && (to === 'running' || item.status === 'running') && to !== 'decided') {
    const { error: testError } = await supabase.from('tests').update({ status: to === 'running' ? 'active' : 'paused' }).eq('id', item.ab_test_id).is('archived_at', null)
    if (testError) back(context, 'erro', testError.message, `&item=${context.code}`)
  }
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

/** A card dropped on another lane of the board: the same move, the same rules, as the drawer's select. */
export async function dropItem(context: BacklogContext, itemId: string, code: string, to: 'queue' | 'ready' | 'running') {
  const formData = new FormData()
  formData.set('to', to)
  await moveItem({ ...context, item_id: itemId, code }, formData)
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
  send_traffic: z.boolean(),
  make_control: z.boolean(),
  publish: z.boolean(),
  follow_up: z.string().trim().max(120),
})

export async function decideItem(context: BacklogContext & { item_id: string; code: string }, formData: FormData) {
  const parsed = decisionSchema.safeParse({
    winner_key: formData.get('winner_key') ?? '',
    result: formData.get('result') ?? '',
    learning: formData.get('learning') ?? '',
    send_traffic: formData.get('send_traffic') === 'on',
    make_control: formData.get('make_control') === 'on',
    publish: formData.get('publish') === 'on',
    follow_up: formData.get('follow_up') ?? '',
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '), `&item=${context.code}`)
  const supabase = await createServerSupabaseClient()
  const winnerKey = parsed.data.winner_key || null
  let winnerCardVariant: { key: string; name: string } | null = null
  if (winnerKey) {
    const { data: variant } = await supabase.from('backlog_variants').select('key, name').eq('item_id', context.item_id).eq('key', winnerKey).maybeSingle()
    if (!variant) back(context, 'erro', `A variante ${winnerKey} não existe neste teste.`, `&item=${context.code}`)
    winnerCardVariant = variant
  }

  // The decision acts where the evidence is: the A/B test that measured the card. Here only the
  // winner is found; the traffic, the control and the card change together in decide_experiment
  // (0079), so the test and the card never disagree.
  const actOnTest = Boolean(winnerCardVariant && (parsed.data.send_traffic || parsed.data.make_control))
  let winnerVariantId: string | null = null
  if (actOnTest) {
    const { data: card } = await supabase.from('backlog_items').select('ab_test_id').eq('id', context.item_id).maybeSingle()
    if (!card?.ab_test_id) back(context, 'erro', 'Este card não tem teste A/B vinculado: não há tráfego para mudar.', `&item=${context.code}`)
    const { data: testVariants, error: readError } = await supabase.from('variants').select('id, name').eq('test_id', card.ab_test_id)
    if (readError || !testVariants?.length) back(context, 'erro', 'Não foi possível ler as variantes do teste A/B.', `&item=${context.code}`)
    winnerVariantId = matchTestVariant(winnerCardVariant!, testVariants)
    if (!winnerVariantId) {
      back(context, 'erro', `Não achei no teste A/B a variante "${winnerCardVariant!.name}". Renomeie a variante do teste com o mesmo nome ou com a letra ${winnerKey}.`, `&item=${context.code}`)
    }
  }
  const { error } = await supabase.rpc('decide_experiment', {
    p_item_id: context.item_id,
    p_winner_key: winnerKey,
    p_result: parsed.data.result,
    p_learning: parsed.data.learning,
    p_publish: parsed.data.publish,
    p_winner_variant_id: winnerVariantId,
    p_send_traffic: actOnTest && parsed.data.send_traffic,
    p_make_control: actOnTest && parsed.data.make_control,
  })
  if (error) {
    back(context, 'erro', error.message.includes('not allowed') ? 'Só gestor ou owner pode decidir o teste e mudar o tráfego. Nada foi alterado.' : `A decisão não foi gravada e nada mudou: ${error.message}`, `&item=${context.code}`)
  }
  const trafficNote = actOnTest
    ? [parsed.data.send_traffic && ' Todo o tráfego do link agora vai para a vencedora.', parsed.data.make_control && ' Ela é o novo controle.'].filter(Boolean).join('')
    : ''
  let followUpNote = ''
  if (parsed.data.follow_up) {
    const { data: original } = await supabase.from('backlog_items').select('stage, method').eq('id', context.item_id).maybeSingle()
    const { data: codes } = await supabase.from('backlog_items').select('code').eq('sales_funnel_id', context.sales_funnel_id)
    const followUpCode = nextCode((codes ?? []).map((row) => row.code as string))
    const method = (original?.method ?? 'link') as Method
    const { data: followUp, error: followUpError } = await supabase
      .from('backlog_items')
      .insert({
        client_id: context.client_id,
        sales_funnel_id: context.sales_funnel_id,
        code: followUpCode,
        title: parsed.data.follow_up,
        hypothesis: `Continuação de ${context.code}: ${parsed.data.learning}`.slice(0, 1000),
        stage: original?.stage ?? 'pagina',
        method,
        impact: 5,
        confidence: 5,
        ease: 5,
        metric: '',
      })
      .select('id')
      .single()
    if (!followUpError && followUp) {
      // The follow-up starts from the winner as its control; the challenger is the new idea.
      const control = winnerCardVariant?.name ?? 'Controle atual'
      await Promise.all([
        supabase.from('backlog_variants').insert([
          { item_id: followUp.id, client_id: context.client_id, key: 'A', name: control, position: 0 },
          { item_id: followUp.id, client_id: context.client_id, key: 'B', name: parsed.data.follow_up, position: 1 },
        ]),
        supabase.from('backlog_gates').insert(defaultGates(method, followUpCode).map((label, index) => ({ item_id: followUp.id, client_id: context.client_id, label, position: index }))),
      ])
      followUpNote = ` ${followUpCode} entrou na Fila como continuação, com ${control} de controle.`
    }
  }
  revalidatePath(`/dashboard/clients/${context.client_slug}/backlog`)
  back(context, 'ok', `${context.code} decidido.${trafficNote}${parsed.data.publish ? ' Publicado para o cliente.' : ''}${followUpNote}`, `&item=${context.code}`)
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
  // "Link /r criado" is a fact the Central knows, not a box to tick: it follows the link.
  await supabase.from('backlog_gates').update({ done_at: testId ? new Date().toISOString() : null }).eq('item_id', context.item_id).eq('label', AUTO_LINK_GATE)
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
