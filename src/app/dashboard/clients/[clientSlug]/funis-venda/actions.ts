'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { syncOneFunnel, syncClientCampaigns } from '@/lib/launchops/sync-funnel'

async function assertNoDuplicateLaunchOpsMapping(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string,
  operacaoIds: string[],
  excludeFunnelId?: string
) {
  let query = supabase.from('sales_funnels').select('id, name, launchops_operacao_ids').eq('client_id', clientId)
  if (excludeFunnelId) query = query.neq('id', excludeFunnelId)
  const { data, error } = await query
  if (error) throw error
  for (const funnel of data ?? []) {
    const overlap = (funnel.launchops_operacao_ids ?? []).filter((id: string) => operacaoIds.includes(id))
    if (overlap.length > 0) {
      throw new Error(
        `Operação(ões) já mapeada(s) no funil "${funnel.name}" — cada operação do LaunchOps só pode pertencer a um funil por cliente, senão o gasto é somado em dobro`
      )
    }
  }
}

// Archive, never delete: deleting cascaded the project's fronts and watchers and left its sales without a project (0100).
export async function setSalesFunnelArchived(salesFunnelId: string, archived: boolean) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc('set_project_archived', { p_sales_funnel_id: salesFunnelId, p_archived: archived })
  if (error) throw new Error(error.message.includes('access denied') ? 'Só gestor ou owner pode arquivar funis.' : error.message)
  // The sidebar, the lists and the project page all show the archive state.
  revalidatePath('/dashboard', 'layout')
}

const projectStatusSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  status: z.enum(['rascunho', 'rodando', 'encerrado']),
})

// Ligar, Encerrar, Reabrir (0102). Rodando syncs, watches and alerts; encerrado stops the sync and
// the watchers, so its numbers stay as they were. is_active follows in the database.
export async function setProjectStatus(input: z.infer<typeof projectStatusSchema>) {
  const parsed = projectStatusSchema.parse(input)
  const supabase = await createServerSupabaseClient()
  if (parsed.status === 'rodando') {
    const { count, error: frontsError } = await supabase
      .from('project_fronts')
      .select('id', { count: 'exact', head: true })
      .eq('sales_funnel_id', parsed.sales_funnel_id)
      .is('archived_at', null)
    if (frontsError) throw frontsError
    if (!count) throw new Error('Funil sem frente: não há de onde vir o gasto. Crie uma frente antes de ligar.')
  }
  const { data, error } = await supabase
    .from('sales_funnels')
    .update({ status: parsed.status, updated_at: new Date().toISOString() })
    .eq('id', parsed.sales_funnel_id)
    .is('archived_at', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Só gestor ou owner pode mudar o estado do funil.')
  // The sidebar, the lists and the project page all show the state.
  revalidatePath('/dashboard', 'layout')
}

const editSalesFunnelSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  client_id: z.string().uuid(),
  client_slug: z.string(),
  funnel_slug: z.string(),
  name: z.string().min(1),
  launchops_operacao_ids: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid('IDs de operação devem ser UUIDs válidos'))),
  // The project's window: a front that reads another project only counts these days (0054).
  starts_on: z.union([z.literal(''), z.iso.date()]).transform((value) => value || null),
  ends_on: z.union([z.literal(''), z.iso.date()]).transform((value) => value || null),
}).refine((value) => !value.starts_on || !value.ends_on || value.ends_on >= value.starts_on, 'o fim da janela vem depois do início')

export async function editSalesFunnel(
  context: { sales_funnel_id: string; client_id: string; client_slug: string; funnel_slug: string },
  formData: FormData
) {
  const result = editSalesFunnelSchema.safeParse({
    sales_funnel_id: context.sales_funnel_id,
    client_id: context.client_id,
    client_slug: context.client_slug,
    funnel_slug: context.funnel_slug,
    name: formData.get('name'),
    launchops_operacao_ids: formData.get('launchops_operacao_ids'),
    starts_on: formData.get('starts_on') ?? '',
    ends_on: formData.get('ends_on') ?? '',
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data

  const supabase = await createServerSupabaseClient()
  const archived = await archivedProjectError(supabase, parsed.sales_funnel_id)
  if (archived) throw new Error(archived)
  await assertNoDuplicateLaunchOpsMapping(supabase, parsed.client_id, parsed.launchops_operacao_ids, parsed.sales_funnel_id)
  const { error } = await supabase
    .from('sales_funnels')
    .update({
      name: parsed.name,
      launchops_operacao_ids: parsed.launchops_operacao_ids,
      starts_on: parsed.starts_on,
      ends_on: parsed.ends_on,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.sales_funnel_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
  redirect(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
}

export async function syncFunnelNow(context: { sales_funnel_id: string; client_slug: string; funnel_slug: string }) {
  const supabase = await createServerSupabaseClient()
  const { data: funnel, error } = await supabase
    .from('sales_funnels')
    .select('id, client_id, archived_at, status, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url)')
    .eq('id', context.sales_funnel_id)
    .single()
  // This select runs on the user's session, so RLS proves they can see the funnel; seeing is not
  // enough to write a sync with the service role, which bypasses RLS, so the role is checked too.
  if (error || !funnel) throw new Error('Funil não encontrado')
  if (funnel.archived_at) throw new Error('Funil arquivado: restaure para atualizar.')
  if (funnel.status === 'rascunho') throw new Error('Funil em rascunho: ligue o funil para sincronizar.')
  if (funnel.status === 'encerrado') throw new Error('Funil encerrado: os números estão congelados. Reabra para atualizar.')
  await assertClientRole(supabase, funnel.client_id, 'gestor')

  const sourceUrl = (funnel.clients as unknown as { funnel_source_url: string | null } | null)?.funnel_source_url
  const appDb = createServiceRoleClient()
  const { funnelSourceServiceRoleKey } = await getClientSecrets(appDb, funnel.client_id)
  if (!sourceUrl || !funnelSourceServiceRoleKey) {
    throw new Error('Configure a fonte de dados do funil na aba Integrações antes de atualizar')
  }

  const launchopsDb = createLaunchOpsClient({ url: sourceUrl, serviceRoleKey: funnelSourceServiceRoleKey })
  // Campaigns first: the creative spend of a project with fronts picks its ads from them.
  await syncClientCampaigns(appDb, launchopsDb, funnel.client_id)
  await syncOneFunnel(appDb, launchopsDb, funnel)

  revalidatePath(`/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}`)
}
