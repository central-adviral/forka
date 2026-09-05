'use server'

import { z } from 'zod'
import { promises as dns } from 'node:dns'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isCnameVerified } from '@/lib/domain/redirect-domain'
import { addProjectDomain, removeProjectDomain } from '@/lib/vercel/domains'

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

  const { data: current } = await supabase
    .from('clients')
    .select('custom_domain')
    .eq('id', parsed.client_id)
    .maybeSingle()

  const added = await addProjectDomain(parsed.custom_domain)
  if (!added.ok) throw new Error(added.error)

  const { error } = await supabase
    .from('clients')
    .update({ custom_domain: parsed.custom_domain, domain_status: 'pending' })
    .eq('id', parsed.client_id)
  if (error) throw error

  if (current?.custom_domain && current.custom_domain !== parsed.custom_domain) {
    await removeProjectDomain(current.custom_domain)
  }

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}

export async function verifyDomain(context: { client_id: string; client_slug: string }): Promise<{ verified: boolean }> {
  const supabase = await createServerSupabaseClient()

  // Re-read the domain to verify from the DB (RLS-scoped to the caller's own clients) instead
  // of trusting a domain string passed in from the caller — otherwise this becomes an open DNS
  // lookup for any domain an authenticated user cares to type in.
  const { data: client } = await supabase.from('clients').select('custom_domain').eq('id', context.client_id).maybeSingle()
  if (!client?.custom_domain) return { verified: false }

  let verified = false
  try {
    const records = await Promise.race([
      dns.resolveCname(client.custom_domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS lookup timed out')), 5000)),
    ])
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
  return { verified }
}

const hublaTokenSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  hubla_webhook_token: z.string().min(16, 'o token deve ter pelo menos 16 caracteres').optional().or(z.literal('')),
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
  // O valor salvo nunca é ecoado de volta pro HTML — campo em branco significa "manter o token atual", não apagar.
  if (!parsed.hubla_webhook_token) return
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ hubla_webhook_token: parsed.hubla_webhook_token })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}

const funnelDataSourceSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  funnel_source_url: z.string().url('informe uma URL válida').optional().or(z.literal('')),
  funnel_source_service_role_key: z.string().optional().or(z.literal('')),
})

export async function saveFunnelDataSource(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = funnelDataSourceSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    funnel_source_url: formData.get('funnel_source_url'),
    funnel_source_service_role_key: formData.get('funnel_source_service_role_key'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const update: { funnel_source_url: string | null; funnel_source_service_role_key?: string } = {
    funnel_source_url: parsed.funnel_source_url || null,
  }
  // O valor salvo nunca é ecoado de volta pro HTML — campo em branco significa "manter a chave atual", não apagar.
  if (parsed.funnel_source_service_role_key) {
    update.funnel_source_service_role_key = parsed.funnel_source_service_role_key
  }
  const { error } = await supabase.from('clients').update(update).eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}
