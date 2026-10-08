import { describe, it, expect } from 'vitest'
import { dailyChance } from './daily-chance'

describe('dailyChance', () => {
  it('accumulates people and buyers day by day and reads the chance at the end of each day', () => {
    const rows = [
      { day: '2026-10-01', variant_id: 'a', people: 500, buyers: 10 },
      { day: '2026-10-01', variant_id: 'b', people: 500, buyers: 12 },
      { day: '2026-10-02', variant_id: 'a', people: 500, buyers: 10 },
      { day: '2026-10-02', variant_id: 'b', people: 500, buyers: 25 },
    ]
    const points = dailyChance(rows, ['a', 'b'], 'a')
    expect(points.map((point) => point.day)).toEqual(['2026-10-01', '2026-10-02'])
    // Day 1: 10 vs 12 out of 500 is a coin toss; by day 2, 20 vs 37 out of 1000 is clear.
    expect(points[0].chances.b!).toBeLessThan(80)
    expect(points[1].chances.b!).toBeGreaterThan(95)
    expect(points[1].chances.a).toBeUndefined()
  })

  it('reads every variant against all the others when there are three or more', () => {
    const rows = ['a', 'b', 'c'].map((id, index) => ({ day: '2026-10-01', variant_id: id, people: 2000, buyers: 40 + index * 20 }))
    const [point] = dailyChance(rows, ['a', 'b', 'c'], 'a')
    expect(Object.keys(point.chances)).toEqual(['a', 'b', 'c'])
    expect(point.chances.c!).toBeGreaterThan(90)
  })

  it('keeps only the last days asked for', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ day: `2026-09-${String(index + 1).padStart(2, '0')}`, variant_id: 'b', people: 10, buyers: 1 }))
    expect(dailyChance(rows, ['a', 'b'], 'a', 30)).toHaveLength(30)
  })
})
