import { describe, it, expect } from 'vitest'
import { PROJECT_RESULTS, readResult, suggestedCost, suggestedVolume } from './project-plan'

describe('project plan', () => {
  it('reads the result, defaulting to compra, and picks the cost metric from it', () => {
    expect(readResult('lead')).toBe('lead')
    expect(readResult(null)).toBe('compra')
    expect(PROJECT_RESULTS.lead.costMetric).toBe('cpl')
    expect(PROJECT_RESULTS.compra.costMetric).toBe('cpa_geral')
  })

  it('suggests the median daily cost and volume, ignoring days without spend or results', () => {
    const days = [
      { spend: 1000, results: 40 },
      { spend: 900, results: 30 },
      { spend: 1200, results: 30 },
      { spend: 500, results: 0 },
      { spend: 0, results: 3 },
    ]
    expect(suggestedCost(days)).toBe(30)
    expect(suggestedVolume(days)).toBe(30)
    expect(suggestedCost([])).toBeNull()
    expect(suggestedVolume([{ spend: 0, results: 2 }])).toBeNull()
  })
})
