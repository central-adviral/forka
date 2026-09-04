'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { httpUrl } from '@/lib/domain/http-url-schema'

const variantSchema = z.object({
  name: z.string().min(1),
  weight_pct: z.coerce.number().gt(0).lte(100),
  destination_url: httpUrl,
  thank_you_url: httpUrl.optional().or(z.literal('')),
})

const createTestSchema = z
  .object({
    client_id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    fallback_url: httpUrl.optional().or(z.literal('')),
    conversion_method: z.enum(['hubla_webhook', 'thank_you_page']),
    test_type: z.enum(['page', 'checkout']),
    sales_page_url: httpUrl.optional().or(z.literal('')),
    variants: z.array(variantSchema).min(2),
  })
  .refine((data) => data.test_type !== 'checkout' || Boolean(data.sales_page_url), {
    message: 'Testes de checkout exigem a URL da página de vendas',
    path: ['sales_page_url'],
  })

export async function createTest(input: z.infer<typeof createTestSchema>) {
  const result = createTestSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('create_test_with_variants', {
    p_client_id: parsed.client_id,
    p_name: parsed.name,
    p_slug: parsed.slug,
    p_fallback_url: parsed.fallback_url || null,
    p_conversion_method: parsed.conversion_method,
    p_test_type: parsed.test_type,
    p_sales_page_url: parsed.sales_page_url || null,
    p_variants: parsed.variants.map((v) => ({
      name: v.name,
      weight_pct: v.weight_pct,
      destination_url: v.destination_url,
      thank_you_url: v.thank_you_url || null,
    })),
  })
  if (error) throw error
}

export async function deleteTest(testId: string, clientSlug: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('tests').delete().eq('id', testId)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${clientSlug}/tests`)
}

const toggleTestStatusSchema = z.object({
  test_id: z.string().uuid(),
  next_status: z.enum(['active', 'paused']),
  client_slug: z.string(),
})

export async function toggleTestStatus(input: z.infer<typeof toggleTestStatusSchema>) {
  const parsed = toggleTestStatusSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tests')
    .update({ status: parsed.next_status })
    .eq('id', parsed.test_id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Test not found or not authorized to update')

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests`)
}
