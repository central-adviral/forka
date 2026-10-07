import { describe, it, expect } from 'vitest'
import { availableMetrics } from './scope-metric-fields'

const metrics = [
  { value: 'cpa_geral', label: 'CPA geral', projectOnly: true, salesOnly: true },
  { value: 'cpl', label: 'CPL', projectOnly: false, salesOnly: false },
  { value: 'cpm', label: 'CPM', projectOnly: false, salesOnly: false },
]

describe('availableMetrics', () => {
  it('offers every metric for the whole project', () => {
    expect(availableMetrics('funnel-1|', metrics).map((option) => option.value)).toEqual(['cpa_geral', 'cpl', 'cpm'])
  })

  it('leaves the CPA out for a front, since the sales belong to the project', () => {
    expect(availableMetrics('funnel-1|front-1', metrics).map((option) => option.value)).toEqual(['cpl', 'cpm'])
  })

  it('never offers a CPA on a lead project, which has no sales', () => {
    expect(availableMetrics('funnel-1|', metrics, 'lead').map((option) => option.value)).toEqual(['cpl', 'cpm'])
  })
})
