'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { setProjectStatus } from '../actions'

// The funnel header of every Configurar › Funil screen (0107). It answers { error } so the header
// keeps what was typed; writes run on the user's session (gestor or owner, open funnel).

export interface HeaderContext {
  client_id: string
  client_slug: string
  sales_funnel_id: string
}

const day = z.union([z.literal(''), z.iso.date()]).transform((value) => value || null)
const headerSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('name'), value: z.string().trim().min(1, 'dê um nome para o funil').max(80, 'o nome tem até 80 letras') }),
  z.object({
    field: z.literal('tag'),
    value: z
      .string()
      .max(24, 'a etiqueta tem até 24 letras')
      .transform((value) => value.toUpperCase().replace(/\s+/g, '') || null),
  }),
  z.object({ field: z.literal('status'), value: z.enum(['rascunho', 'rodando', 'encerrado']) }),
  z
    .object({ field: z.literal('window'), value: z.object({ starts_on: day, ends_on: day }) })
    .refine((input) => !input.value.starts_on || !input.value.ends_on || input.value.ends_on >= input.value.starts_on, 'o fim da janela vem depois do início'),
])

export type HeaderChange = z.input<typeof headerSchema>

export async function saveFunnelHeader(context: HeaderContext, change: HeaderChange): Promise<{ error: string | null }> {
  const parsed = headerSchema.safeParse(change)
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join('; ') }
  const supabase = await createServerSupabaseClient()
  if (!(await canActAs(supabase, context.client_id, 'gestor'))) return { error: 'Só gestor ou owner pode mudar o funil.' }
  const archived = await archivedProjectError(supabase, context.sales_funnel_id)
  if (archived) return { error: archived }

  const input = parsed.data
  if (input.field === 'status') {
    // Ligar, Encerrar, Reabrir keep their rules (0102): rodando needs a front, encerrado stops the sync.
    try {
      await setProjectStatus({ sales_funnel_id: context.sales_funnel_id, status: input.value })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Não foi possível mudar o status. Tente de novo.' }
    }
    return { error: null }
  }

  const values =
    input.field === 'name' ? { name: input.value } : input.field === 'tag' ? { tag: input.value } : { starts_on: input.value.starts_on, ends_on: input.value.ends_on }
  const { data, error } = await supabase
    .from('sales_funnels')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', context.sales_funnel_id)
    .select('id')
  if (error) {
    if (error.code === '23505') return { error: `Outro funil deste cliente já usa a etiqueta ${input.field === 'tag' ? input.value : ''}.` }
    return { error: error.message }
  }
  if (!data?.length) return { error: 'Só gestor ou owner pode mudar o funil.' }
  // The sidebar, the picker and every screen of the funnel show its name and window.
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  return { error: null }
}
