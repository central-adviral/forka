import type { Method, TestRules } from './backlog'
import { probabilityToBeBest, probabilityToBeatControl } from './significance'

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

/** Spend and entry purchases per variant of a Meta creative test (the creative report already carries the tax), with the rules' verdict. */
export function readMetaTest(code: string, keys: string[], creatives: CreativeRow[], rules: TestRules): MetaVariantRead[] {
  return keys.map((key) => {
    const tagged = creatives.filter((row) => tagKey(row.ad_name ?? '', code) === key)
    const spend = tagged.reduce((sum, row) => sum + Number(row.spend ?? 0), 0)
    const sales = tagged.reduce((sum, row) => sum + Number(row.sales_count ?? 0), 0)
    const cpa = sales > 0 ? spend / sales : null
    let verdict: Verdict = 'measuring'
    if (tagged.length === 0) verdict = 'no_data'
    // Cut: the limit spent with no sale, or spent at a CPA that is itself past the limit (one sale
    // at R$ 300 against a R$ 55 ceiling is not a reason to keep paying).
    else if (spend >= rules.teto * rules.mult && (sales === 0 || (cpa !== null && cpa >= rules.teto * rules.mult))) verdict = 'cut'
    else if (cpa !== null && cpa <= rules.teto && sales >= rules.min) verdict = 'win'
    return { key, ads: tagged.length, spend, sales, cpa, verdict }
  })
}

export interface LinkRow {
  variant_id: string
  variant_name: string
  visits: number
  conversions: number
  weight_pct?: number
}

export interface LinkVariantRead {
  name: string
  isControl: boolean
  weightPct: number
  visits: number
  conversions: number
  /** Chance, 0–1, of beating the control; null for the control or without visitors. */
  chance: number | null
  /** People each side needs before a verdict counts; null while the control has no conversion to size it from. */
  needed: number | null
  verdict: Verdict
}

/** Inverse of the standard normal CDF (Acklam's approximation, error below 1e-9 in the range used here). */
function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - low) return -normalQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * People per side to detect a lift of `mdePct` over the control's rate, one-sided at the rules'
 * confidence with 80% power. Peeking every day and stopping at the first "winner" crowns false
 * winners; fixing the sample up front is what makes the confidence mean what it says.
 */
export function requiredVisitsPerArm(controlRate: number, confPct: number, mdePct: number): number | null {
  if (!(controlRate > 0 && controlRate < 1)) return null
  const p1 = controlRate
  const p2 = Math.min(0.999, p1 * (1 + mdePct / 100))
  const z = normalQuantile(confPct / 100) + normalQuantile(0.8)
  return Math.ceil((z * z * (p1 * (1 - p1) + p2 * (1 - p2))) / ((p2 - p1) * (p2 - p1)))
}

/**
 * Per-person read of the linked A/B test. A verdict needs both sides past the sample the control's
 * rate calls for (never below the visitor floor) and, for a win, the rules' minimum conversions;
 * then a challenger wins or is cut at the confidence.
 */
export function readLinkTest(rows: LinkRow[], controlVariantId: string | undefined, rules: TestRules, rand?: () => number): LinkVariantRead[] {
  const control = rows.find((row) => row.variant_id === controlVariantId) ?? rows[0]
  const controlVisits = Number(control?.visits ?? 0)
  const controlRate = controlVisits > 0 ? Number(control?.conversions ?? 0) / controlVisits : 0
  const sample = requiredVisitsPerArm(controlRate, rules.conf, rules.mde)
  const needed = sample === null ? null : Math.max(rules.minVisits, sample)
  // With three or more variants a win needs the chance of being the best of all, not of beating the
  // control alone: several duels with the control each give a lucky variant a way to "win".
  const best = rows.length >= 3 ? probabilityToBeBest(rows, rand) : null
  return rows.map((row, index) => {
    const isControl = row.variant_id === control?.variant_id
    // A cut is still "loses to the control"; only the win asks for the best of all.
    const versusControl = isControl ? null : probabilityToBeatControl(control, row, rand)
    const chance = isControl ? null : best ? best[index] : versusControl
    const enough = needed !== null && Number(row.visits) >= needed && controlVisits >= needed
    let verdict: Verdict = Number(row.visits) === 0 ? 'no_data' : 'measuring'
    if (chance !== null && enough && chance * 100 >= rules.conf && Number(row.conversions) >= rules.min) verdict = 'win'
    else if (versusControl !== null && enough && (1 - versusControl) * 100 >= rules.conf) verdict = 'cut'
    return { name: row.variant_name, isControl, weightPct: Number(row.weight_pct ?? 0), visits: Number(row.visits), conversions: Number(row.conversions), chance, needed, verdict }
  })
}

/** One line for the card: what the rules say about the test right now, or null when nothing yet. */
export function readoutSummary(verdicts: { label: string; verdict: Verdict }[], daysRunning: number, rules: TestRules, method: Method): string | null {
  const winners = verdicts.filter((v) => v.verdict === 'win').map((v) => v.label)
  const cuts = verdicts.filter((v) => v.verdict === 'cut').map((v) => v.label)
  if (winners.length > 0) return `vencedora pelos critérios: ${winners.join(', ')}`
  if (cuts.length > 0) return `cortar: ${cuts.join(', ')}`
  if (method === 'meta' && daysRunning > rules.sat) return `${daysRunning} dias rodando, pede decisão`
  return null
}
