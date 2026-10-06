import { describe, it, expect } from 'vitest'
import { availableMetrics } from './scope-metric-fields'

const metrics = [
  { value: 'cpa_geral', label: 'CPA geral', projectOnly: true },
  { value: 'cpm', label: 'CPM', projectOnly: false },
]

describe('availableMetrics', () => {
  it('offers every metric for the whole project', () => {
    expect(availableMetrics('funnel-1|', metrics).map((option) => option.value)).toEqual(['cpa_geral', 'cpm'])
  })

  it('leaves the CPA out for a front, since the sales belong to the project', () => {
    expect(availableMetrics('funnel-1|front-1', metrics).map((option) => option.value)).toEqual(['cpm'])
  })
})
