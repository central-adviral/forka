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

const createTestSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  fallback_url: httpUrl.optional().or(z.literal('')),
  conversion_method: z.enum(['hubla_webhook', 'thank_you_page']),
  variants: z.array(variantSchema).min(2),
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
  revalidatePath(`/dashboard/clients/${clientSlug}`)
}
