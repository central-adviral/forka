'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
  context: { sales_funnel_id: string; client_slug: string; funnel_slug: string },
  formData: FormData
) {
  const result = editSalesFunnelSchema.safeParse({
    sales_funnel_id: context.sales_funnel_id,
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
