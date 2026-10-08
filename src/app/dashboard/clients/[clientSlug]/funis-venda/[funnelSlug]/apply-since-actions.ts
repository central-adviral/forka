'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Changes to products and naming rules apply from now on (0101). "Aplicar desde" is the one
// explicit way to change the past, always previewed first.

interface ApplySinceContext {
  sales_funnel_id: string
  path: string
}

interface ApplySinceRow {
  sales_changed: number
  sales_in: number
  revenue_in: number
  sales_out: number
  revenue_out: number
  role_changed: number
  campaigns_changed: number
  spend_in: number
  spend_out: number
}

export interface ApplySincePreview {
  since: string | null
  text: string | null
  error: string | null
}

const sinceSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'escolha a data')

const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const dayLabel = (since: string) => `${since.slice(8, 10)}/${since.slice(5, 7)}`

function errorMessage(error: { message: string }): string {
  if (error.message.includes('access denied')) return 'Só gestor ou owner pode aplicar desde uma data.'
  if (error.message.includes('invalid date')) return 'Escolha uma data até hoje.'
  return error.message
}

function describe(since: string, row: ApplySinceRow): string {
  const n = (value: number) => Number(value)
  const parts: string[] = []
  if (n(row.sales_changed) === 0) parts.push(`Nenhuma venda desde ${dayLabel(since)} muda.`)
  else {
    const details = [
      n(row.sales_in) > 0 ? `${n(row.sales_in)} entram neste projeto (${currency(n(row.revenue_in))} líquido)` : null,
      n(row.sales_out) > 0 ? `${n(row.sales_out)} saem dele (${currency(n(row.revenue_out))} líquido)` : null,
      n(row.role_changed) > 0 ? `${n(row.role_changed)} mudam de papel` : null,
    ].filter(Boolean)
    parts.push(`${n(row.sales_changed)} ${n(row.sales_changed) === 1 ? 'venda' : 'vendas'} desde ${dayLabel(since)} mudam${details.length ? `: ${details.join('; ')}` : ''}.`)
  }
  if (n(row.campaigns_changed) === 0) parts.push('Nenhuma campanha muda de dono.')
  else {
    const spend = [
      n(row.spend_in) > 0 ? `${currency(n(row.spend_in))} de gasto entram` : null,
      n(row.spend_out) > 0 ? `${currency(n(row.spend_out))} saem` : null,
    ].filter(Boolean)
    parts.push(
      `${n(row.campaigns_changed)} ${n(row.campaigns_changed) === 1 ? 'campanha muda' : 'campanhas mudam'} de dono${spend.length ? ` (${spend.join(', ')})` : ''}, com o histórico inteiro dela.`
    )
  }
  return parts.join(' ')
}

export async function previewApplySince(context: ApplySinceContext, _previous: ApplySincePreview | null, formData: FormData): Promise<ApplySincePreview> {
  const result = sinceSchema.safeParse(formData.get('since'))
  if (!result.success) return { since: null, text: null, error: result.error.issues.map((issue) => issue.message).join('; ') }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('preview_apply_since', { p_sales_funnel_id: context.sales_funnel_id, p_since: result.data })
  if (error) return { since: null, text: null, error: errorMessage(error) }
  return { since: result.data, text: describe(result.data, (data as ApplySinceRow[])[0]), error: null }
}

export async function applySince(context: ApplySinceContext, formData: FormData) {
  const result = sinceSchema.safeParse(formData.get('since'))
  if (!result.success) redirect(`${context.path}?erro=${encodeURIComponent('Escolha a data antes de aplicar.')}`)
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('apply_config_since', { p_sales_funnel_id: context.sales_funnel_id, p_since: result.data })
  if (error) redirect(`${context.path}?erro=${encodeURIComponent(errorMessage(error))}`)
  revalidatePath(context.path)
  redirect(`${context.path}?ok=${encodeURIComponent(`Aplicado desde ${dayLabel(result.data)}. ${describe(result.data, (data as ApplySinceRow[])[0])}`)}`)
}
