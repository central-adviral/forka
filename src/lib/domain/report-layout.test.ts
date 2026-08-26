import { describe, it, expect } from 'vitest'
import { computeReportLayout } from './report-layout'

const variants = [
  { id: 'a', name: 'A', weightPct: 50, visits: 1706, conversions: 58, destinationUrl: 'https://example.com/a' },
  { id: 'b', name: 'B', weightPct: 30, visits: 1024, conversions: 61, destinationUrl: 'https://example.com/b' },
  { id: 'c', name: 'C', weightPct: 20, visits: 682, conversions: 14, destinationUrl: 'https://example.com/c' },
]

describe('computeReportLayout', () => {
  it('lays out one node column per variant, stacked without overlap', () => {
    const layout = computeReportLayout(variants, false)
    expect(layout.variants).toHaveLength(3)
    for (let i = 1; i < layout.variants.length; i++) {
      const prevBottom = layout.variants[i - 1].node.y + layout.variants[i - 1].node.h
      expect(layout.variants[i].node.y).toBeGreaterThanOrEqual(prevBottom)
    }
  })

  it('marks the variant with the highest conversion rate as leader', () => {
    const layout = computeReportLayout(variants, false)
    const leaders = layout.variants.filter((v) => v.isLeader)
    expect(leaders).toHaveLength(1)
    expect(leaders[0].id).toBe('b')
  })

  it('colors the leader conversion edge amber and others teal', () => {
    const layout = computeReportLayout(variants, false)
    const leader = layout.variants.find((v) => v.id === 'b')!
    const other = layout.variants.find((v) => v.id === 'a')!
    expect(leader.conversionEdge.color).toBe('#F5B94D')
    expect(other.conversionEdge.color).toBe('#2DD4A8')
  })

  it('gives thicker traffic edges to variants with more visits', () => {
    const layout = computeReportLayout(variants, false)
    const a = layout.variants.find((v) => v.id === 'a')!
    const c = layout.variants.find((v) => v.id === 'c')!
    expect(a.trafficEdge.strokeWidth).toBeGreaterThan(c.trafficEdge.strokeWidth)
  })

  it('declares no leader when no variant has any visits', () => {
    const noVisits = variants.map((v) => ({ ...v, visits: 0, conversions: 0 }))
    const layout = computeReportLayout(noVisits, false)
    expect(layout.variants.every((v) => !v.isLeader)).toBe(true)
  })

  it('omits the fallback node when not configured', () => {
    expect(computeReportLayout(variants, false).fallback).toBeNull()
  })

  it('includes a fallback node when configured', () => {
    expect(computeReportLayout(variants, true).fallback).not.toBeNull()
  })

  it('throws on an empty variant list', () => {
    expect(() => computeReportLayout([], false)).toThrow()
  })
})
