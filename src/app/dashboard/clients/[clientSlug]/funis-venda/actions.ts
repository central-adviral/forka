'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { syncOneFunnel } from '@/lib/launchops/sync-funnel'

async function assertNoDuplicateLaunchOpsMapping(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string,
  operacaoIds: string[],
  excludeFunnelId?: string
) {
  let query = supabase.from('sales_funnels').select('id, name, launchops_operacao_ids').eq('client_id', clientId)
  if (excludeFunnelId) query = query.neq('id', excludeFunnelId)
  const { data, error } = await query
  if (error) throw error
  for (const funnel of data ?? []) {
    const overlap = (funnel.launchops_operacao_ids ?? []).filter((id: string) => operacaoIds.includes(id))
    if (overlap.length > 0) {
      throw new Error(
        `Operação(ões) já mapeada(s) no funil "${funnel.name}" — cada operação do LaunchOps só pode pertencer a um funil de venda por cliente, senão o gasto é somado em dobro`
      )
    }
  }
}

const createSalesFunnelSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  launchops_operacao_ids: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid('IDs de operação devem ser UUIDs válidos'))),
  launchops_produto_nomes: z.string(),
})

export async function createSalesFunnel(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = createSalesFunnelSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    name: formData.get('name'),
    slug: formData.get('slug'),
    launchops_operacao_ids: formData.get('launchops_operacao_ids'),
    launchops_produto_nomes: formData.get('launchops_produto_nomes'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const produtoNomes = parsed.launchops_produto_nomes.split(',').map((s) => s.trim()).filter(Boolean)

  const supabase = await createServerSupabaseClient()
  await assertNoDuplicateLaunchOpsMapping(supabase, parsed.client_id, parsed.launchops_operacao_ids)
  const { error } = await supabase.from('sales_funnels').insert({
    client_id: parsed.client_id,
    name: parsed.name,
    slug: parsed.slug,
    launchops_operacao_ids: parsed.launchops_operacao_ids,
    launchops_produto_nomes: produtoNomes,
  })
  if (error) {
    if (error.code === '23505') {
      throw new Error('Já existe um funil com esse slug neste cliente')
    }
    throw error
  }
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
  redirect(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
}

export async function deleteSalesFunnel(salesFunnelId: string, clientSlug: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('sales_funnels').delete().eq('id', salesFunnelId)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${clientSlug}/funis-venda`)
}

const toggleSalesFunnelStatusSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  is_active: z.boolean(),
  client_slug: z.string(),
})

export async function toggleSalesFunnelStatus(input: z.infer<typeof toggleSalesFunnelStatusSchema>) {
  const parsed = toggleSalesFunnelStatusSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('sales_funnels')
    .update({ is_active: parsed.is_active })
    .eq('id', parsed.sales_funnel_id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Sales funnel not found or not authorized to update')

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
}

const editSalesFunnelSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  client_id: z.string().uuid(),
  client_slug: z.string(),
  funnel_slug: z.string(),
  name: z.string().min(1),
  launchops_operacao_ids: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid('IDs de operação devem ser UUIDs válidos'))),
  launchops_produto_nomes: z.string(),
})

export async function editSalesFunnel(
  context: { sales_funnel_id: string; client_id: string; client_slug: string; funnel_slug: string },
  formData: FormData
) {
  const result = editSalesFunnelSchema.safeParse({
    sales_funnel_id: context.sales_funnel_id,
    client_id: context.client_id,
    client_slug: context.client_slug,
    funnel_slug: context.funnel_slug,
    name: formData.get('name'),
    launchops_operacao_ids: formData.get('launchops_operacao_ids'),
    launchops_produto_nomes: formData.get('launchops_produto_nomes'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const produtoNomes = parsed.launchops_produto_nomes.split(',').map((s) => s.trim()).filter(Boolean)

  const supabase = await createServerSupabaseClient()
  await assertNoDuplicateLaunchOpsMapping(supabase, parsed.client_id, parsed.launchops_operacao_ids, parsed.sales_funnel_id)
  const { error } = await supabase
    .from('sales_funnels')
    .update({
      name: parsed.name,
      launchops_operacao_ids: parsed.launchops_operacao_ids,
      launchops_produto_nomes: produtoNomes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.sales_funnel_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
  redirect(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
}

export async function syncFunnelNow(context: { sales_funnel_id: string; client_slug: string; funnel_slug: string }) {
  const supabase = await createServerSupabaseClient()
  const { data: funnel, error } = await supabase
    .from('sales_funnels')
    .select('id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url, funnel_source_service_role_key)')
    .eq('id', context.sales_funnel_id)
    .single()
  if (error || !funnel) throw new Error('Funil não encontrado')

  const source = funnel.clients as unknown as {
    funnel_source_url: string | null
    funnel_source_service_role_key: string | null
  } | null
  if (!source?.funnel_source_url || !source?.funnel_source_service_role_key) {
    throw new Error('Configure a fonte de dados do funil na aba Integrações antes de atualizar')
  }

  const launchopsDb = createLaunchOpsClient({ url: source.funnel_source_url, serviceRoleKey: source.funnel_source_service_role_key })
  const appDb = createServiceRoleClient()
  await syncOneFunnel(appDb, launchopsDb, funnel)

  revalidatePath(`/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}`)
}
