import { probabilityToBeBest, probabilityToBeatControl } from './significance'

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

// The one leader rule every screen uses (list, report summary, canvas). Two variants: the challenger
// leads when its chance to beat the control passes 50%; otherwise the control leads, with the chance
// that no challenger beats it. Three or more: the variant most likely to be the best of all.
export function testLeader(rows: VariantResult[], controlVariantId: string | undefined, rand?: () => number): TestLeader | null {
  const control = rows.find((row) => row.variant_id === controlVariantId) ?? rows[0]
  if (!control) return null
  // Three or more variants: the leader is the one most likely to be the best of all, not the best
  // of several one-on-one duels with the control, which would crown a lucky variant.
  if (rows.length >= 3) {
    const chances = probabilityToBeBest(rows)
    let top = -1
    chances.forEach((chance, index) => {
      if (chance !== null && (top < 0 || chance > (chances[top] ?? -1))) top = index
    })
    return top < 0 ? null : { variantId: rows[top].variant_id, name: rows[top].variant_name, confidencePct: Math.round((chances[top] ?? 0) * 100) }
  }
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
