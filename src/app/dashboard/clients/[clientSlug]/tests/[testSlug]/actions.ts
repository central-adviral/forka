'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { httpUrl } from '@/lib/domain/http-url-schema'
import { layerConflict } from '@/lib/domain/test-layers'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { buildInsightPrompt, type InsightVariantStat } from '@/lib/domain/insight-prompt'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { detectSampleRatioMismatch } from '@/lib/domain/srm-check'
import { reportTrust } from '@/lib/domain/test-trust'
import { daysRunningSince } from '@/lib/domain/report-period'
import { createAnthropicClient } from '@/lib/anthropic/client'
import { assertClientRole } from '@/lib/repo/client-access-repo'

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
  if (error) throw layerConflict(error) ?? error
  if (!data || data.length === 0) throw new Error('Teste não encontrado ou você não tem permissão para alterá-lo.')

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}

const generateInsightSchema = z.object({
  test_id: z.string().uuid(),
  since_iso: z.string().datetime().nullable(),
  until_iso: z.string().datetime().nullable(),
})

interface InsightReportRow {
  variant_id: string
  variant_name: string
  weight_pct: number
  visits: number
  conversions: number
  revenue_cents: number
}

export async function generateInsight(input: z.infer<typeof generateInsightSchema>): Promise<string> {
  const parsed = generateInsightSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  // The insight is a paid model call: only who runs the test may trigger it, not the client.
  const { data: testRow, error: testRowError } = await supabase.from('tests').select('client_id, sales_funnel_id, created_at').eq('id', parsed.test_id).maybeSingle()
  if (testRowError) throw testRowError
  if (!testRow) throw new Error('Teste não encontrado.')
  await assertClientRole(supabase, testRow.client_id, 'gestor')

  const { data: variantRows, error: variantError } = await supabase
    .from('variants')
    .select('id, is_control')
    .eq('test_id', parsed.test_id)
  if (variantError) throw variantError
  if (!variantRows || variantRows.length === 0) throw new Error('Teste não encontrado.')

  const { data: report, error: reportError } = await supabase.rpc('get_test_report', {
    p_test_id: parsed.test_id,
    p_since: parsed.since_iso,
    p_until: parsed.until_iso,
  })
  if (reportError) throw reportError
  if (!report || report.length === 0) throw new Error('Sem dados suficientes para gerar insight')

  const reportRows = report as InsightReportRow[]
  const controlId = variantRows.find((v) => v.is_control)?.id
  const controlRow = reportRows.find((row) => row.variant_id === controlId) ?? reportRows[0]

  const variants: InsightVariantStat[] = reportRows.map((row) => {
    const isControl = row.variant_id === controlRow.variant_id
    const confidence = !isControl
      ? probabilityToBeatControl(
          { visits: controlRow.visits, conversions: controlRow.conversions },
          { visits: row.visits, conversions: row.conversions }
        )
      : null
    return {
      name: row.variant_name,
      isControl,
      visits: row.visits,
      conversions: row.conversions,
      revenueCents: Number(row.revenue_cents),
      confidencePct: confidence !== null ? Math.round(confidence * 100) : null,
    }
  })

  // The same seal the report shows, so the model reads the test with the same caution.
  const daysRunning = daysRunningSince(testRow.created_at)
  const trust = reportTrust(
    detectSampleRatioMismatch(reportRows.map((row) => ({ weightPct: Number(row.weight_pct), visits: row.visits }))),
    reportRows.map((row) => ({ isControl: row.variant_id === controlRow.variant_id, weightPct: Number(row.weight_pct), visits: row.visits, conversions: row.conversions })),
    daysRunning
  )
  const quality = { trust: trust.explain, trustworthy: trust.trustworthy, daysRunning, neededPerArm: trust.needed, ownLayer: Boolean(testRow.sales_funnel_id) }

  const anthropic = createAnthropicClient()
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: buildInsightPrompt(variants, quality) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) throw new Error('A IA não retornou texto')
  return textBlock.text.trim()
}

const updateTestSchema = z.object({
  test_id: z.string().uuid(),
  client_slug: z.string(),
  test_slug: z.string(),
  test_type: z.enum(['page', 'checkout']),
  fallback_url: httpUrl.optional().or(z.literal('')),
  sales_page_url: httpUrl.optional().or(z.literal('')),
  sales_funnel_id: z.string().uuid().optional().or(z.literal('')),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        // 0 parks a variant: kept in the test, no new traffic (0067).
        weight_pct: z.coerce.number().gte(0).lte(100),
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

  const supabase = await createServerSupabaseClient()

  // Verify every submitted variant actually belongs to this test before writing anything,
  // so a stale/mismatched id fails the whole request up front instead of leaving some
  // variants updated and others not (these calls aren't wrapped in a DB transaction).
  const { data: test, error: testFetchError } = await supabase
    .from('tests')
    .select('test_type, variants(id, name)')
    .eq('id', parsed.test_id)
    .maybeSingle()
  if (testFetchError) throw testFetchError
  if (!test) throw new Error('Teste não encontrado ou você não tem permissão para alterá-lo.')

  // Catch this here so the operator gets a Portuguese message instead of the raw
  // tests_checkout_requires_sales_page constraint error from Postgres. Sourced from the
  // database's own test_type, not parsed.test_type, since that value comes from the client.
  if (test.test_type === 'checkout' && !parsed.sales_page_url) {
    throw new Error('Testes de checkout exigem a URL da página de vendas')
  }

  const variantNameById = new Map((test.variants ?? []).map((v) => [v.id, v.name]))
  const foreignVariant = parsed.variants.find((v) => !variantNameById.has(v.id))
  if (foreignVariant) {
    throw new Error(`Variante ${foreignVariant.id} não pertence a este teste`)
  }

  const { error: testError } = await supabase
    .from('tests')
    .update({
      fallback_url: parsed.fallback_url || null,
      sales_page_url: parsed.sales_page_url || null,
      sales_funnel_id: parsed.sales_funnel_id || null,
    })
    .eq('id', parsed.test_id)
  if (testError) throw layerConflict(testError) ?? testError

  // Uma única statement de upsert pra todas as variantes (em vez de um update por variante)
  // — evita ficar com só algumas variantes atualizadas se uma falhar no meio do loop.
  const { error: variantsError } = await supabase.from('variants').upsert(
    parsed.variants.map((variant) => ({
      id: variant.id,
      test_id: parsed.test_id,
      name: variantNameById.get(variant.id)!,
      weight_pct: variant.weight_pct,
      destination_url: variant.destination_url,
      thank_you_url: variant.thank_you_url || null,
    }))
  )
  if (variantsError) throw variantsError

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}
