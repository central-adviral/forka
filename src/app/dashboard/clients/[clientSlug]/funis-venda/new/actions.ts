'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PROJECT_RESULTS } from '@/lib/domain/project-plan'
import { PRODUCT_ROLES } from '@/lib/domain/product-roles'
import { isSafeProbeUrl, pageKey } from '@/lib/domain/page-probe'
import { PAGE_KINDS, PAGE_KIND_LABEL, blocksDraft, isBlocked, seals, type WizardProject } from '@/lib/domain/project-wizard'
import { STAGE_NAME, measureOfMetric } from '@/lib/domain/funnel-stages'
import { copyStages, createStage } from '@/lib/repo/funnel-stages-repo'

// Writes run on the user's session: the policies of sales_funnels, project_fronts, naming_rules,
// pages, watchers and project_products only let a gestor or owner of the client write them.

const metric = z.enum(['compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'])
const day = z.union([z.literal(''), z.iso.date()])
const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'o endereço usa letras minúsculas, números e hífen'),
  slugEdited: z.boolean(),
  model: z.enum(['pago', 'gratuito', 'perpetuo', 'captacao']).nullable(),
  primary: metric,
  primaryTarget: z.number(),
  secondary: metric,
  secondaryTarget: z.number(),
  startsOn: day,
  endsOn: day,
  duplicatedFrom: z.string().nullable(),
  duplicatedFromId: z.uuid().nullable(),
  products: z.record(z.string().max(200), z.enum(PRODUCT_ROLES)),
  fronts: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().trim().min(1).max(60),
        code: z.string().trim().min(1).max(24),
        kind: z.enum(['propria', 'espelho']),
        tag: z.string().max(120),
        tagEdited: z.boolean(),
        sourceProjectId: z.uuid().nullable(),
        windowStart: day,
        windowEnd: day,
        own: z.boolean(),
        primary: metric,
        primaryTarget: z.number(),
        secondary: metric,
        secondaryTarget: z.number(),
        pages: z.array(z.object({ kind: z.enum(PAGE_KINDS), url: z.string().max(500), review: z.boolean().optional() })).max(10),
      })
    )
    .max(20),
})

const positive = (value: number) => (value > 0 ? value : null)

export async function createProject(context: { client_id: string; client_slug: string }, input: WizardProject, ligar: boolean): Promise<{ error: string }> {
  const parsed = projectSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
  const project = parsed.data
  const supabase = await createServerSupabaseClient()

  // The same seals the screen showed, recomputed on what the database has now. Campaign disputes
  // need the live preview and stay a screen check.
  const [{ data: pageRows, error: pagesError }, { data: projectRows, error: projectsError }] = await Promise.all([
    supabase.from('pages').select('url, is_active').eq('client_id', context.client_id),
    supabase.from('sales_funnels').select('slug').eq('client_id', context.client_id),
  ])
  if (pagesError || projectsError) return { error: (pagesError ?? projectsError)!.message }
  const found = seals(project, {
    campaigns: [],
    existingPages: (pageRows ?? []).map((page) => ({ url: page.url, where: 'outro funil' })),
    activePages: (pageRows ?? []).filter((page) => page.is_active).length,
    takenSlugs: (projectRows ?? []).map((row) => row.slug),
  })
  if (ligar ? isBlocked(found) : blocksDraft(found)) {
    return { error: found.filter((seal) => seal.tone === 'crit' && (ligar || !seal.draftOk)).map((seal) => seal.text).join(' ') }
  }
  const unsafe = project.fronts.flatMap((front) => front.pages).find((page) => page.url.trim() && (!isSafeProbeUrl(page.url.trim()) || !pageKey(page.url.trim())))
  if (unsafe) return { error: `${unsafe.url}: use o endereço https público da página (sem IP nem endereço interno).` }

  const { data: funnel, error } = await supabase
    .from('sales_funnels')
    .insert({
      client_id: context.client_id,
      name: project.name,
      slug: project.slug,
      status: ligar ? 'rodando' : 'rascunho',
      modelo: project.model,
      resultado: project.primary,
      metrica_secundaria: project.secondary,
      starts_on: project.startsOn || null,
      ends_on: project.endsOn || null,
    })
    .select('id')
    .single()
  if (error) return { error: error.code === '23505' ? 'Já existe um funil com esse endereço neste cliente.' : error.message }

  const failure = await fillProject(supabase, context.client_id, funnel.id, project)
  if (failure) {
    // A project that was born a moment ago has no history: undoing it is safe, and better than half a project.
    await supabase.from('sales_funnels').delete().eq('id', funnel.id)
    return { error: failure }
  }
  revalidatePath('/dashboard', 'layout')
  // The 0105 trigger already put each front in the stage of its metric: the next step is the journey.
  redirect(`/dashboard/clients/${context.client_slug}/funis-venda/${project.slug}/regras`)
}

async function fillProject(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string,
  funnelId: string,
  project: z.infer<typeof projectSchema>
): Promise<string | null> {
  const planWatchers = [
    { metric: project.primary, target: positive(project.primaryTarget), is_plan: true, plan_role: 'principal' },
    { metric: project.secondary, target: positive(project.secondaryTarget), is_plan: false, plan_role: 'secundaria' },
  ].filter((watcher) => watcher.target !== null)
  if (planWatchers.length) {
    const { error } = await supabase
      .from('watchers')
      .insert(planWatchers.map((watcher) => ({ ...watcher, client_id: clientId, sales_funnel_id: funnelId, metric: PROJECT_RESULTS[watcher.metric].costMetric })))
    if (error) return error.message
  }

  // A duplicate keeps the source's stages and combos, and each copied front its original's stage.
  // Any other front lands in the stage of its metric's measure, made by the 0105 trigger.
  let stageByCode = new Map<string, string>()
  if (project.duplicatedFromId) {
    try {
      stageByCode = await copyStages(supabase, project.duplicatedFromId, funnelId)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  for (const [position, front] of project.fronts.entries()) {
    const mirror = front.kind === 'espelho'
    // The front's own metrics become its watchers through the 0102 trigger.
    const { data: saved, error } = await supabase
      .from('project_fronts')
      .insert({
        sales_funnel_id: funnelId,
        stage_id: stageByCode.get(front.code.toUpperCase()) ?? null,
        code: front.code.toUpperCase(),
        name: front.name,
        position,
        source_sales_funnel_id: mirror ? front.sourceProjectId : null,
        janela_inicio: mirror ? front.windowStart || null : null,
        janela_fim: mirror ? front.windowEnd || null : null,
        metrica_principal: front.own ? front.primary : null,
        alvo_principal: front.own ? positive(front.primaryTarget) : null,
        metrica_secundaria: front.own ? front.secondary : null,
        alvo_secundaria: front.own ? positive(front.secondaryTarget) : null,
      })
      .select('id')
      .single()
    if (error) return error.code === '23505' ? `Duas frentes com o código ${front.code.toUpperCase()}.` : error.message
    if (mirror) continue
    if (front.tag.trim()) {
      const { error: ruleError } = await supabase.from('naming_rules').insert({ front_id: saved.id, kind: 'include', value: front.tag.trim() })
      if (ruleError) return ruleError.message
    }
    const pages = front.pages.filter((page) => page.url.trim())
    if (pages.length) {
      const { error: pagesError } = await supabase.from('pages').insert(
        pages.map((page) => ({ client_id: clientId, sales_funnel_id: funnelId, front_id: saved.id, url: page.url.trim(), label: `${PAGE_KIND_LABEL[page.kind]} · ${front.name}`, tipo: page.kind }))
      )
      if (pagesError) return pagesError.code === '23505' ? `Uma página da frente ${front.name} já está na sonda.` : pagesError.message
    }
  }

  // A project with no front still has a stage where its result lives.
  const { count: stages, error: stagesError } = await supabase.from('funnel_stages').select('id', { count: 'exact', head: true }).eq('sales_funnel_id', funnelId)
  if (stagesError) return stagesError.message
  if (!stages) {
    const measure = measureOfMetric(project.primary)
    const target = positive(project.primaryTarget)
    try {
      await createStage(supabase, funnelId, {
        name: STAGE_NAME[measure],
        tag: null,
        measure,
        position: 0,
        parallel: false,
        janelaInicio: null,
        janelaFim: null,
        meta: project.primary === measure ? target : null,
        metaRoas: project.primary === 'roas' ? target : null,
      })
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  const products = Object.entries(project.products)
  if (products.length) {
    const { error } = await supabase.from('project_products').insert(products.map(([produto_nome, papel]) => ({ sales_funnel_id: funnelId, produto_nome, papel })))
    if (error) return error.message
  }

  // The result watchers were written before the stages: a meta equal to its stage's now follows it (0106).
  const { error: followError } = await supabase.rpc('normalize_funnel_targets', { p_sales_funnel_id: funnelId })
  if (followError) return followError.message
  return null
}
