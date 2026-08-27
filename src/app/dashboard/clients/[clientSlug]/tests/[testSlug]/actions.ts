'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { httpUrl } from '@/lib/domain/http-url-schema'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'

const toggleSchema = z.object({
  test_id: z.string().uuid(),
  next_status: z.enum(['active', 'paused']),
  client_slug: z.string(),
  test_slug: z.string(),
})

export async function toggleTestStatus(input: z.infer<typeof toggleSchema>) {
  const parsed = toggleSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tests')
    .update({ status: parsed.next_status })
    .eq('id', parsed.test_id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Test not found or not authorized to update')

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}

const updateTestSchema = z.object({
  test_id: z.string().uuid(),
  client_slug: z.string(),
  test_slug: z.string(),
  test_type: z.enum(['page', 'checkout']),
  fallback_url: httpUrl.optional().or(z.literal('')),
  sales_page_url: httpUrl.optional().or(z.literal('')),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        weight_pct: z.coerce.number().gt(0).lte(100),
        destination_url: httpUrl,
        thank_you_url: httpUrl.optional().or(z.literal('')),
      })
    )
    .min(2),
})

export async function updateTest(input: z.infer<typeof updateTestSchema>) {
  const result = updateTestSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data

  if (!weightsSumTo100(parsed.variants.map((v) => v.weight_pct))) {
    throw new Error('Os pesos das variantes devem somar 100%')
  }

  // Catch this here so the operator gets a Portuguese message instead of the raw
  // tests_checkout_requires_sales_page constraint error from Postgres.
  if (parsed.test_type === 'checkout' && !parsed.sales_page_url) {
    throw new Error('Testes de checkout exigem a URL da página de vendas')
  }

  const supabase = await createServerSupabaseClient()

  // Verify every submitted variant actually belongs to this test before writing anything,
  // so a stale/mismatched id fails the whole request up front instead of leaving some
  // variants updated and others not (these calls aren't wrapped in a DB transaction).
  const { data: ownedVariants, error: ownedError } = await supabase.from('variants').select('id').eq('test_id', parsed.test_id)
  if (ownedError) throw ownedError
  const ownedIds = new Set((ownedVariants ?? []).map((v) => v.id))
  const foreignVariant = parsed.variants.find((v) => !ownedIds.has(v.id))
  if (foreignVariant) {
    throw new Error(`Variante ${foreignVariant.id} não pertence a este teste`)
  }

  const { error: testError } = await supabase
    .from('tests')
    .update({
      fallback_url: parsed.fallback_url || null,
      sales_page_url: parsed.sales_page_url || null,
    })
    .eq('id', parsed.test_id)
  if (testError) throw testError

  for (const variant of parsed.variants) {
    const { error } = await supabase
      .from('variants')
      .update({
        weight_pct: variant.weight_pct,
        destination_url: variant.destination_url,
        thank_you_url: variant.thank_you_url || null,
      })
      .eq('id', variant.id)
    if (error) throw error
  }

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}
