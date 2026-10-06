'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'

const ROLES = ['owner', 'gestor', 'analista', 'cliente'] as const

const addMemberSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  email: z.string().trim().toLowerCase().email('informe um e-mail válido'),
  role: z.enum(ROLES),
})

function membersPath(clientSlug: string): string {
  return `/dashboard/clients/${clientSlug}/membros`
}

// Errors come back to the page as a query param: the database's own message (last owner, duplicate
// member) is what the owner needs to read, and an error boundary would throw the form away.
function back(clientSlug: string, param: 'ok' | 'erro', message: string): never {
  redirect(`${membersPath(clientSlug)}?${param}=${encodeURIComponent(message)}`)
}

async function appOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function addMember(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = addMemberSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!result.success) back(context.client_slug, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const parsed = result.data

  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, parsed.client_id, 'owner')

  // Looking an e-mail up and inviting are service-role operations; the membership itself is then
  // written on the owner's own session, so RLS still has the last word on who may add whom.
  const serviceDb = createServiceRoleClient()
  const { data: existingUserId, error: lookupError } = await serviceDb.rpc('user_id_by_email', { p_email: parsed.email })
  if (lookupError) throw lookupError

  let userId = existingUserId as string | null
  let invited = false
  if (!userId) {
    const { data, error } = await serviceDb.auth.admin.inviteUserByEmail(parsed.email, {
      redirectTo: `${await appOrigin()}/definir-senha`,
    })
    if (error) back(parsed.client_slug, 'erro', `Não foi possível enviar o convite: ${error.message}`)
    userId = data.user.id
    invited = true
  }

  const { error } = await supabase.from('memberships').insert({ client_id: parsed.client_id, user_id: userId, role: parsed.role })
  if (error) {
    back(parsed.client_slug, 'erro', error.code === '23505' ? `${parsed.email} já é membro deste cliente.` : error.message)
  }

  revalidatePath(membersPath(parsed.client_slug))
  back(
    parsed.client_slug,
    'ok',
    invited ? `Convite enviado para ${parsed.email}.` : `${parsed.email} agora tem acesso a este cliente.`
  )
}

const changeRoleSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  user_id: z.string().uuid(),
  role: z.enum(ROLES),
})

export async function changeMemberRole(
  context: { client_id: string; client_slug: string; user_id: string },
  formData: FormData
) {
  const parsed = changeRoleSchema.parse({ ...context, role: formData.get('role') })
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('memberships')
    .update({ role: parsed.role })
    .eq('client_id', parsed.client_id)
    .eq('user_id', parsed.user_id)
    .select('user_id')
  if (error) back(parsed.client_slug, 'erro', lastOwnerMessage(error.message))
  if (!data || data.length === 0) back(parsed.client_slug, 'erro', 'Só um owner pode mudar papéis.')
  revalidatePath(membersPath(parsed.client_slug))
  back(parsed.client_slug, 'ok', 'Papel atualizado.')
}

export async function removeMember(context: { client_id: string; client_slug: string; user_id: string }) {
  const parsed = changeRoleSchema.omit({ role: true }).parse(context)
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('memberships')
    .delete()
    .eq('client_id', parsed.client_id)
    .eq('user_id', parsed.user_id)
    .select('user_id')
  if (error) back(parsed.client_slug, 'erro', lastOwnerMessage(error.message))
  if (!data || data.length === 0) back(parsed.client_slug, 'erro', 'Só um owner pode remover membros.')
  revalidatePath(membersPath(parsed.client_slug))
  back(parsed.client_slug, 'ok', 'Acesso removido.')
}

function lastOwnerMessage(message: string): string {
  return message.includes('at least one owner')
    ? 'O cliente precisa de pelo menos um owner. Promova outra pessoa antes de mudar ou remover este acesso.'
    : message
}
