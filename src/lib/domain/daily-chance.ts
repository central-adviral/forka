import { probabilityToBeBest, probabilityToBeatControl } from './significance'

// The chance of winning as it stood at the end of each day, from the people and buyers summed up to
// that day. A line that keeps crossing the rule's bar is still luck; one that settles above it is
// a result.

export interface DailyRow {
  day: string
  variant_id: string
  people: number
  buyers: number
}

export interface DailyChancePoint {
  day: string
  /** Chance in %, per challenger (or per variant with three or more), null without people yet. */
  chances: Record<string, number | null>
}

export function dailyChance(rows: DailyRow[], variantIds: string[], controlId: string, maxDays = 30): DailyChancePoint[] {
  const days = [...new Set(rows.map((row) => row.day))].sort()
  const totals = new Map(variantIds.map((id) => [id, { visits: 0, conversions: 0 }]))
  const points: DailyChancePoint[] = []
  for (const day of days) {
    for (const row of rows.filter((candidate) => candidate.day === day)) {
      const total = totals.get(row.variant_id)
      if (!total) continue
      total.visits += Number(row.people)
      total.conversions += Number(row.buyers)
    }
    const control = totals.get(controlId)!
    const chances: Record<string, number | null> = {}
    if (variantIds.length >= 3) {
      const best = probabilityToBeBest(variantIds.map((id) => totals.get(id)!))
      variantIds.forEach((id, index) => (chances[id] = best[index] === null ? null : Math.round(best[index]! * 100)))
    } else {
      for (const id of variantIds) {
        if (id === controlId) continue
        const chance = probabilityToBeatControl(control, totals.get(id)!, undefined, 4000)
        chances[id] = chance === null ? null : Math.round(chance * 100)
      }
    }
    points.push({ day, chances })
  }
  return points.slice(-maxDays)
}
