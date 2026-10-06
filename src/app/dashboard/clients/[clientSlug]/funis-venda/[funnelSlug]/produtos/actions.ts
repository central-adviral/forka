'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PRODUCT_ROLES } from '@/lib/domain/product-roles'

// Writes go through the user's session: the 0061 policies only let a gestor or owner change a
// project's products. The 0061 trigger re-labels the sales and keeps the sync's list in step.

interface ProductsContext {
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

function productsPath(context: ProductsContext): string {
  return `/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}/produtos`
}

function back(context: ProductsContext, param: 'ok' | 'erro', message: string): never {
  redirect(`${productsPath(context)}?${param}=${encodeURIComponent(message)}`)
}

const productSchema = z.object({
  produto_nome: z.string().trim().min(1, 'informe o produto').max(200),
  papel: z.enum(PRODUCT_ROLES, 'escolha o papel do produto'),
})

export async function setProductRole(context: ProductsContext, formData: FormData) {
  const result = productSchema.safeParse({ produto_nome: formData.get('produto_nome'), papel: formData.get('papel') })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('project_products')
    .upsert({ sales_funnel_id: context.sales_funnel_id, ...result.data }, { onConflict: 'sales_funnel_id,produto_nome' })
    .select('produto_nome')
  if (error || !data || data.length === 0) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode alterar os produtos.')
  revalidatePath(productsPath(context))
  back(context, 'ok', `${result.data.produto_nome} salvo. As vendas dele entram no próximo sync.`)
}

export async function removeProduct(context: ProductsContext & { produto_nome: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('project_products')
    .delete()
    .eq('sales_funnel_id', context.sales_funnel_id)
    .eq('produto_nome', context.produto_nome)
    .select('produto_nome')
  if (error) back(context, 'erro', error.message)
  if (!data || data.length === 0) back(context, 'erro', 'Só gestor ou owner pode remover produtos.')
  revalidatePath(productsPath(context))
  back(context, 'ok', `${context.produto_nome} saiu do projeto, com as vendas dele.`)
}
