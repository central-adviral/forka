/**
 * Backfills utm_* on sales synced before migration 0039 added the columns.
 *
 * Why not re-run the sync: syncSalesForFunnel upserts the whole row -- valor, status,
 * conversion_id -- and reaching the old sales means resetting the funnel's cursor, which
 * reprocesses ~30k real rows to fix five columns. This writes only those five instead; the
 * money fields never appear in the payload, so a bug here cannot reach them.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   npx tsx scripts/backfill-sales-utm.ts                 # report only
 *   npx tsx scripts/backfill-sales-utm.ts --limit=50      # trial slice, still dry
 *   npx tsx scripts/backfill-sales-utm.ts --limit=50 --apply
 *   npx tsx scripts/backfill-sales-utm.ts --apply         # everything
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null

// PostgREST/Kong caps an `.in()` filter's query string around 200-650 ids -- the same bound the
// sales sync already chunks against.
const CHUNK = 200
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

type UtmKey = (typeof UTM_KEYS)[number]
type Utms = Record<UtmKey, string | null>
interface PendingSale {
  id: string
  external_id: string
}

function readEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta ${name}. Rode \`vercel env pull\` antes.`)
  return value
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function countSales(appDb: SupabaseClient, filter: 'todas' | 'com_conversao' | 'sem_utm'): Promise<number> {
  let query = appDb.from('sales').select('id', { count: 'exact', head: true })
  if (filter === 'com_conversao') query = query.not('conversion_id', 'is', null)
  if (filter === 'sem_utm') query = query.is('utm_term', null)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/** Read in pages: a plain select stops at PostgREST's ~1000-row ceiling. */
async function fetchSalesMissingUtm(appDb: SupabaseClient, salesFunnelId: string): Promise<PendingSale[]> {
  const rows: PendingSale[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await appDb
      .from('sales')
      .select('id, external_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('source', 'launchops_sync')
      .is('utm_term', null)
      .not('external_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as PendingSale[]))
    if (!data || data.length < pageSize) break
    if (LIMIT && rows.length >= LIMIT) break
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows
}

async function fetchLaunchOpsUtms(launchopsDb: SupabaseClient, ids: string[]): Promise<Map<string, Utms>> {
  const byId = new Map<string, Utms>()
  for (const chunk of chunked(ids, CHUNK)) {
    // Spelled out rather than built from UTM_KEYS: supabase-js parses the select string at the
    // type level, and a template literal makes it give up.
    const { data, error } = await launchopsDb
      .from('vendas')
      .select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
      .in('id', chunk)
    if (error) throw error
    for (const row of (data ?? []) as unknown as ({ id: string } & Partial<Utms>)[]) {
      // LaunchOps stores "no value" as an empty string on most rows. Writing '' would mark the
      // sale as filled while saying nothing; NULL keeps meaning "unknown", which is the truth.
      byId.set(row.id, Object.fromEntries(UTM_KEYS.map((k) => [k, blankToNull(row[k])])) as Utms)
    }
  }
  return byId
}

async function backfillFunnel(
  appDb: SupabaseClient,
  launchopsDb: SupabaseClient,
  funnel: { id: string; name: string }
): Promise<void> {
  const pending = await fetchSalesMissingUtm(appDb, funnel.id)
  console.log(`\n[${funnel.name}] ${pending.length} vendas sem UTM${LIMIT ? ` (limitado a ${LIMIT})` : ''}`)
  if (pending.length === 0) return

  const utmsByExternalId = await fetchLaunchOpsUtms(launchopsDb, [...new Set(pending.map((s) => s.external_id))])

  // One update per distinct UTM tuple rather than per sale: a handful of tuples cover every sale
  // in this account, so this is a few requests instead of tens of thousands.
  const byTuple = new Map<string, { utms: Utms; saleIds: string[] }>()
  let notFound = 0
  let noUtmAtSource = 0
  for (const sale of pending) {
    const utms = utmsByExternalId.get(sale.external_id)
    if (!utms) {
      notFound++
      continue
    }
    if (UTM_KEYS.every((k) => utms[k] === null)) {
      noUtmAtSource++
      continue
    }
    const key = JSON.stringify(UTM_KEYS.map((k) => utms[k]))
    const bucket = byTuple.get(key) ?? { utms, saleIds: [] }
    bucket.saleIds.push(sale.id)
    byTuple.set(key, bucket)
  }

  const buckets = [...byTuple.values()].sort((a, b) => b.saleIds.length - a.saleIds.length)
  const willUpdate = buckets.reduce((sum, b) => sum + b.saleIds.length, 0)
  const comNomeDeAnuncio = buckets.reduce((sum, b) => sum + (b.utms.utm_term ? b.saleIds.length : 0), 0)
  console.log(`  preenchíveis: ${willUpdate}`)
  console.log(`  ...destas, com nome de anúncio (utm_term): ${comNomeDeAnuncio}`)
  console.log(`  sem nenhuma UTM na origem (ficam NULL): ${noUtmAtSource}`)
  console.log(`  não encontradas no LaunchOps: ${notFound}`)
  console.log(`  combinações distintas: ${buckets.length}`)
  for (const { utms, saleIds } of buckets.slice(0, 15)) {
    const parts = UTM_KEYS.map((k) => `${k.replace('utm_', '')}=${utms[k] ?? '—'}`).join(' | ')
    console.log(`    ${String(saleIds.length).padStart(6)} × ${parts}`)
  }
  if (buckets.length > 15) console.log(`    … e mais ${buckets.length - 15} combinações`)

  if (!APPLY) {
    console.log('  (dry run — nada foi escrito)')
    return
  }

  let updated = 0
  for (const { utms, saleIds } of byTuple.values()) {
    for (const chunk of chunked(saleIds, CHUNK)) {
      // The payload is these five keys and nothing else. valor_bruto, valor_liquido, status and
      // conversion_id are not reachable from here.
      const { error } = await appDb.from('sales').update(utms).in('id', chunk)
      if (error) throw error
      updated += chunk.length
    }
  }
  console.log(`  ATUALIZADAS: ${updated}`)
}

async function main() {
  const appDb = createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const before = {
    total: await countSales(appDb, 'todas'),
    comConversao: await countSales(appDb, 'com_conversao'),
    semUtm: await countSales(appDb, 'sem_utm'),
  }
  console.log('ANTES:', before, APPLY ? '· MODO APPLY' : '· dry run')

  const { data: funnels, error } = await appDb
    .from('sales_funnels')
    .select('id, name, clients(funnel_source_url, funnel_source_service_role_key)')
  if (error) throw error

  for (const funnel of funnels ?? []) {
    const source = funnel.clients as unknown as {
      funnel_source_url: string | null
      funnel_source_service_role_key: string | null
    } | null
    if (!source?.funnel_source_url || !source?.funnel_source_service_role_key) {
      console.log(`\n[${funnel.name}] sem credencial do LaunchOps — pulado`)
      continue
    }
    const launchopsDb = createClient(source.funnel_source_url, source.funnel_source_service_role_key, {
      auth: { persistSession: false },
    })
    await backfillFunnel(appDb, launchopsDb, funnel as { id: string; name: string })
  }

  const after = {
    total: await countSales(appDb, 'todas'),
    comConversao: await countSales(appDb, 'com_conversao'),
    semUtm: await countSales(appDb, 'sem_utm'),
  }
  console.log('\nDEPOIS:', after)

  // Only utm_term should have moved. Anything else means this script did something it must not.
  if (after.total !== before.total) throw new Error(`ABORTO: total de vendas mudou ${before.total} -> ${after.total}`)
  if (after.comConversao !== before.comConversao) {
    throw new Error(`ABORTO: vendas com conversão mudaram ${before.comConversao} -> ${after.comConversao}`)
  }
  console.log(`\nInvariantes OK. Vendas sem UTM: ${before.semUtm} -> ${after.semUtm}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
