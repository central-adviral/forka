'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import { isSafeProbeUrl } from '@/lib/domain/page-probe'
import { probeClientPages } from '@/lib/pages/probe'

interface PainelContext {
  client_id: string
  client_slug: string
}

function back(context: PainelContext, param: 'ok' | 'erro', message: string): never {
  redirect(`/dashboard/clients/${context.client_slug}/painel?${param}=${encodeURIComponent(message)}#paginas`)
}

const pageSchema = z.object({
  label: z.string().trim().min(1, 'dê um nome para a página').max(60),
  url: z
    .string()
    .trim()
    .refine(isSafeProbeUrl, 'use o endereço https público da página (sem IP nem endereço interno)'),
})

export async function addPage(context: PainelContext, formData: FormData) {
  const result = pageSchema.safeParse({ label: formData.get('label'), url: formData.get('url') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('pages').insert({ client_id: context.client_id, ...result.data })
  if (error) back(context, 'erro', error.code === '23505' ? 'Essa página já está na sonda.' : error.code === '42501' ? 'Só gestor ou owner pode cadastrar páginas.' : error.message)
  revalidatePath(`/dashboard/clients/${context.client_slug}/painel`)
  back(context, 'ok', `${result.data.label} entrou na sonda. Ela é checada a cada sincronização.`)
}

export async function removePage(context: PainelContext & { page_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('pages').delete().eq('id', context.page_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode remover páginas.')
  revalidatePath(`/dashboard/clients/${context.client_slug}/painel`)
  back(context, 'ok', 'Página removida da sonda.')
}

// The checks are written with the service role (page_checks has no write policy), so the caller's
// role is checked first on their own session.
export async function checkPagesNow(context: PainelContext) {
  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, context.client_id, 'gestor')
  const count = await probeClientPages(createServiceRoleClient(), context.client_id)
  revalidatePath(`/dashboard/clients/${context.client_slug}/painel`)
  revalidatePath(`/dashboard/clients/${context.client_slug}`)
  back(context, 'ok', count > 0 ? `${count} ${count === 1 ? 'página checada' : 'páginas checadas'} agora.` : 'Nenhuma página ativa para checar.')
}
