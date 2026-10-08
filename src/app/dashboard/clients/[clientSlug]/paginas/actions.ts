'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import { MAX_PAGES_PER_CLIENT, isSafeProbeUrl } from '@/lib/domain/page-probe'
import { PAGE_TO_PROBE_COLUMNS, probeClientPages, probePage, probePages, type PageToProbe, type ProbeResult } from '@/lib/pages/probe'

interface PagesContext {
  client_id: string
  client_slug: string
}

function back(context: PagesContext, param: 'ok' | 'erro', message: string, anchor = ''): never {
  redirect(`/dashboard/clients/${context.client_slug}/paginas?${param}=${encodeURIComponent(message)}${anchor}`)
}

function refresh(context: PagesContext) {
  revalidatePath(`/dashboard/clients/${context.client_slug}/paginas`)
  revalidatePath(`/dashboard/clients/${context.client_slug}`)
}

const urlSchema = z
  .string()
  .trim()
  .refine(isSafeProbeUrl, 'use o endereço https público da página (sem IP nem endereço interno)')

const pageSchema = z.object({
  label: z.string().trim().min(1, 'dê um nome para a página').max(60),
  url: urlSchema,
  sales_funnel_id: z.uuid().nullable(),
  watch_pixel: z.boolean(),
  watch_checkout: z.boolean(),
  required_text: z.string().trim().max(120, 'o texto obrigatório tem até 120 caracteres').nullable(),
})

function readPageForm(formData: FormData) {
  const text = (name: string) => {
    const value = formData.get(name)
    return typeof value === 'string' && value.trim() !== '' ? value : null
  }
  return pageSchema.safeParse({
    label: formData.get('label'),
    url: formData.get('url'),
    sales_funnel_id: text('sales_funnel_id'),
    watch_pixel: formData.get('watch_pixel') === 'on',
    watch_checkout: formData.get('watch_checkout') === 'on',
    required_text: text('required_text'),
  })
}

/** Adds a page, or saves the page `page_id` when editing. */
export async function savePage(context: PagesContext & { page_id?: string }, formData: FormData) {
  const result = readPageForm(formData)
  const formUrl = `/dashboard/clients/${context.client_slug}/paginas/${context.page_id ? `${context.page_id}/editar` : 'nova'}`
  if (!result.success) redirect(`${formUrl}?erro=${encodeURIComponent(result.error.issues.map((issue) => issue.message).join('; '))}`)
  const supabase = await createServerSupabaseClient()
  if (!context.page_id) {
    const { count } = await supabase.from('pages').select('id', { count: 'exact', head: true }).eq('client_id', context.client_id).eq('is_active', true)
    if ((count ?? 0) >= MAX_PAGES_PER_CLIENT) back(context, 'erro', `A sonda acompanha até ${MAX_PAGES_PER_CLIENT} páginas por cliente. Tire uma para cadastrar outra.`)
  }
  const { error } = context.page_id
    ? await supabase.from('pages').update(result.data).eq('id', context.page_id).eq('client_id', context.client_id)
    : await supabase.from('pages').insert({ client_id: context.client_id, ...result.data })
  if (error) {
    const message =
      error.code === '23505' ? 'Essa página já está na sonda.'
      : error.code === '42501' ? 'Só gestor ou owner pode cadastrar páginas.'
      : error.code === '23503' ? 'Esse projeto não é deste cliente.'
      : error.message
    redirect(`${formUrl}?erro=${encodeURIComponent(message)}`)
  }
  refresh(context)
  back(context, 'ok', context.page_id ? `${result.data.label} salva.` : `${result.data.label} entrou na sonda. Ela é checada a cada hora.`)
}

export interface TestPageResult {
  error: string | null
  result: ProbeResult | null
}

/** "Testar agora" on the add form: the full probe once, nothing saved. */
export async function testPage(context: PagesContext, _previous: TestPageResult | null, formData: FormData): Promise<TestPageResult> {
  const supabase = await createServerSupabaseClient()
  // The probe makes requests from the server: only who can register pages can trigger one.
  await assertClientRole(supabase, context.client_id, 'gestor')
  const url = urlSchema.safeParse(formData.get('url'))
  if (!url.success) return { error: url.error.issues[0].message, result: null }
  return { error: null, result: await probePage(url.data, { watchPixel: true, watchCheckout: true, requiredText: null }, { readTitle: true }) }
}

export async function removePage(context: PagesContext & { page_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('pages').delete().eq('id', context.page_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode remover páginas.')
  refresh(context)
  back(context, 'ok', 'Página tirada da sonda.')
}

/** Pausar / retomar: a paused page stays listed with its history but is not checked. */
export async function setPageActive(context: PagesContext & { page_id: string; active: boolean }) {
  const supabase = await createServerSupabaseClient()
  if (context.active) {
    const { count } = await supabase.from('pages').select('id', { count: 'exact', head: true }).eq('client_id', context.client_id).eq('is_active', true)
    if ((count ?? 0) >= MAX_PAGES_PER_CLIENT) back(context, 'erro', `A sonda já acompanha ${MAX_PAGES_PER_CLIENT} páginas. Pause ou tire outra antes.`)
  }
  const { data, error } = await supabase.from('pages').update({ is_active: context.active }).eq('id', context.page_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode pausar a sonda.')
  refresh(context)
  back(context, 'ok', context.active ? 'Sonda retomada.' : 'Sonda pausada para esta página.', `#pagina-${context.page_id}`)
}

/** Planned maintenance: the page keeps being checked but raises no critical for an hour. */
export async function silencePage(context: PagesContext & { page_id: string; hours: number }) {
  const supabase = await createServerSupabaseClient()
  const until = context.hours > 0 ? new Date(Date.now() + Math.min(context.hours, 24) * 3_600_000).toISOString() : null
  const { data, error } = await supabase.from('pages').update({ silenced_until: until }).eq('id', context.page_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode silenciar a página.')
  refresh(context)
  back(context, 'ok', until ? 'Página silenciada por 1h. A sonda continua checando.' : 'Aviso reativado.', `#pagina-${context.page_id}`)
}

// The checks are written with the service role (page_checks has no write policy), so the caller's
// role is checked first on their own session.
export async function checkPagesNow(context: PagesContext) {
  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, context.client_id, 'gestor')
  const count = await probeClientPages(createServiceRoleClient(), context.client_id)
  refresh(context)
  back(context, 'ok', count > 0 ? `${count} ${count === 1 ? 'página checada' : 'páginas checadas'} agora.` : 'Nenhuma página ativa para checar.')
}

export async function checkPageNow(context: PagesContext & { page_id: string }) {
  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, context.client_id, 'gestor')
  const appDb = createServiceRoleClient()
  const { data: page, error } = await appDb.from('pages').select(PAGE_TO_PROBE_COLUMNS).eq('id', context.page_id).eq('client_id', context.client_id).maybeSingle()
  if (error) throw error
  if (!page) back(context, 'erro', 'Página não encontrada.')
  await probePages(appDb, [page as PageToProbe])
  refresh(context)
  back(context, 'ok', 'Página checada de novo.', `#pagina-${context.page_id}`)
}
