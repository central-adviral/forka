import { probabilityToBeatControl } from './significance'

export interface VariantResult {
  variant_id: string
  variant_name: string
  visits: number
  conversions: number
}

export interface TestLeader {
  variantId: string
  name: string
  /** Chance, in %, that the leader really is ahead. */
  confidencePct: number
}

// The one leader rule every screen uses (list, report summary, canvas): the challenger with the best
// chance to beat the control leads when that chance passes 50%; otherwise the control leads, with
// the chance that no challenger beats it.
export function testLeader(rows: VariantResult[], controlVariantId: string | undefined, rand?: () => number): TestLeader | null {
  const control = rows.find((row) => row.variant_id === controlVariantId) ?? rows[0]
  if (!control) return null
  let best: { row: VariantResult; p: number } | null = null
  for (const row of rows) {
    if (row.variant_id === control.variant_id) continue
    const p = probabilityToBeatControl(control, row, rand)
    if (p !== null && (!best || p > best.p)) best = { row, p }
  }
  if (!best) return null
  return best.p >= 0.5
    ? { variantId: best.row.variant_id, name: best.row.variant_name, confidencePct: Math.round(best.p * 100) }
    : { variantId: control.variant_id, name: control.variant_name, confidencePct: Math.round((1 - best.p) * 100) }
}
