'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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

const httpUrl = z.string().url().regex(/^https?:\/\//i, 'A URL deve começar com http:// ou https://')

const updateTestSchema = z.object({
  test_id: z.string().uuid(),
  client_slug: z.string(),
  test_slug: z.string(),
  fallback_url: httpUrl.optional().or(z.literal('')),
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

  const totalWeight = parsed.variants.reduce((sum, v) => sum + v.weight_pct, 0)
  if (Math.abs(totalWeight - 100) > 0.02) {
    throw new Error('Os pesos das variantes devem somar 100%')
  }

  const supabase = await createServerSupabaseClient()

  const { error: testError } = await supabase
    .from('tests')
    .update({ fallback_url: parsed.fallback_url || null })
    .eq('id', parsed.test_id)
  if (testError) throw testError

  for (const variant of parsed.variants) {
    const { data, error } = await supabase
      .from('variants')
      .update({
        weight_pct: variant.weight_pct,
        destination_url: variant.destination_url,
        thank_you_url: variant.thank_you_url || null,
      })
      .eq('id', variant.id)
      .eq('test_id', parsed.test_id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error(`Variante ${variant.id} não pertence a este teste`)
  }

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}
