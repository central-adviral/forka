'use server'

import { z } from 'zod'
import { promises as dns } from 'node:dns'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isCnameVerified } from '@/lib/domain/redirect-domain'

const domainSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  custom_domain: z
    .string()
    .min(1, 'informe um domínio')
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i,
      'domínio inválido — use o formato de um domínio real, ex: ir.seudominio.com'
    ),
})

export async function saveDomain(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = domainSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    custom_domain: formData.get('custom_domain'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ custom_domain: parsed.custom_domain, domain_status: 'pending' })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}

export async function verifyDomain(context: { client_id: string; client_slug: string }) {
  const supabase = await createServerSupabaseClient()

  // Re-read the domain to verify from the DB (RLS-scoped to the caller's own clients) instead
  // of trusting a domain string passed in from the caller — otherwise this becomes an open DNS
  // lookup for any domain an authenticated user cares to type in.
  const { data: client } = await supabase.from('clients').select('custom_domain').eq('id', context.client_id).maybeSingle()
  if (!client?.custom_domain) return

  let verified = false
  try {
    const records = await dns.resolveCname(client.custom_domain)
    verified = isCnameVerified(records)
  } catch {
    verified = false
  }
  const { error } = await supabase
    .from('clients')
    .update({ domain_status: verified ? 'verified' : 'pending' })
    .eq('id', context.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${context.client_slug}/integrations`)
}

const hublaTokenSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  hubla_webhook_token: z.string().min(1, 'informe um token'),
})

export async function saveHublaToken(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = hublaTokenSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    hubla_webhook_token: formData.get('hubla_webhook_token'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ hubla_webhook_token: parsed.hubla_webhook_token })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}
