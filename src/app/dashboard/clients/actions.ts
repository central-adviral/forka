'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const createClientSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'use apenas letras minúsculas, números e hífen'),
})

export async function createClient(formData: FormData) {
  const result = createClientSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('clients').insert({
    name: parsed.name,
    slug: parsed.slug,
    owner_id: user.id,
  })
  if (error) throw error

  revalidatePath('/dashboard')
  redirect('/dashboard?created=1')
}
