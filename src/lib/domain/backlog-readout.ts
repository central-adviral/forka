import type { Method, TestRules } from './backlog'
import { probabilityToBeatControl } from './significance'

// Reads a running backlog test against the project's rules. It only suggests: the gestor decides.

export type Verdict = 'cut' | 'win' | 'measuring' | 'no_data'

export interface CreativeRow {
  ad_name: string
  spend: number
  sales_count: number
}

export interface MetaVariantRead {
  key: string
  ads: number
  spend: number
  sales: number
  cpa: number | null
  verdict: Verdict
}

/** The variant key an ad carries in its name, e.g. "Prova social [T4-B]" → "B" for T4. */
export function tagKey(adName: string, code: string): string | null {
  const match = adName.match(new RegExp(`\\[${code}-([A-Z])\\]`, 'i'))
  return match ? match[1].toUpperCase() : null
}

/** Spend (with tax) and ad purchases per variant of a Meta creative test, with the rules' verdict. */
export function readMetaTest(code: string, keys: string[], creatives: CreativeRow[], rules: TestRules, taxFactor: number): MetaVariantRead[] {
  return keys.map((key) => {
    const tagged = creatives.filter((row) => tagKey(row.ad_name ?? '', code) === key)
    const spend = tagged.reduce((sum, row) => sum + Number(row.spend ?? 0), 0) * taxFactor
    const sales = tagged.reduce((sum, row) => sum + Number(row.sales_count ?? 0), 0)
    const cpa = sales > 0 ? spend / sales : null
    let verdict: Verdict = 'measuring'
    if (tagged.length === 0) verdict = 'no_data'
    else if (sales === 0 && spend >= rules.teto * rules.mult) verdict = 'cut'
    else if (cpa !== null && cpa <= rules.teto && sales >= rules.min) verdict = 'win'
    return { key, ads: tagged.length, spend, sales, cpa, verdict }
  })
}

export interface LinkRow {
  variant_id: string
  variant_name: string
  visits: number
  conversions: number
}

export interface LinkVariantRead {
  name: string
  isControl: boolean
  visits: number
  conversions: number
  /** Chance, 0–1, of beating the control; null for the control or without visitors. */
  chance: number | null
  verdict: Verdict
}

/** Per-person read of the linked A/B test: past both visitor floors, a challenger wins or is cut at the confidence. */
export function readLinkTest(rows: LinkRow[], controlVariantId: string | undefined, rules: TestRules, rand: () => number = Math.random): LinkVariantRead[] {
  const control = rows.find((row) => row.variant_id === controlVariantId) ?? rows[0]
  return rows.map((row) => {
    const isControl = row.variant_id === control?.variant_id
    const chance = isControl ? null : probabilityToBeatControl(control, row, rand)
    const enough = Number(row.visits) >= rules.minVisits && Number(control?.visits ?? 0) >= rules.minVisits
    let verdict: Verdict = Number(row.visits) === 0 ? 'no_data' : 'measuring'
    if (chance !== null && enough && chance * 100 >= rules.conf) verdict = 'win'
    else if (chance !== null && enough && (1 - chance) * 100 >= rules.conf) verdict = 'cut'
    return { name: row.variant_name, isControl, visits: Number(row.visits), conversions: Number(row.conversions), chance, verdict }
  })
}

/** One line for the card: what the rules say about the test right now, or null when nothing yet. */
export function readoutSummary(verdicts: { label: string; verdict: Verdict }[], daysRunning: number, rules: TestRules, method: Method): string | null {
  const winners = verdicts.filter((v) => v.verdict === 'win').map((v) => v.label)
  const cuts = verdicts.filter((v) => v.verdict === 'cut').map((v) => v.label)
  if (winners.length > 0) return `vencedora pelas regras: ${winners.join(', ')}`
  if (cuts.length > 0) return `cortar: ${cuts.join(', ')}`
  if (method === 'meta' && daysRunning > rules.sat) return `${daysRunning} dias rodando, pede decisão`
  return null
}
