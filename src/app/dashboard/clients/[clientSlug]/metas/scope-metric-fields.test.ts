import { describe, it, expect } from 'vitest'
import { availableMetrics } from './scope-metric-fields'

const metrics = [
  { value: 'cpa_geral', label: 'CPA geral', projectOnly: true, salesOnly: true },
  { value: 'cpa_anuncio', label: 'CPA de anúncio', projectOnly: false, salesOnly: true },
  { value: 'roas', label: 'ROAS', projectOnly: false, salesOnly: true },
  { value: 'cpl', label: 'CPL', projectOnly: false, salesOnly: false },
  { value: 'cpm', label: 'CPM', projectOnly: false, salesOnly: false },
]

describe('availableMetrics', () => {
  it('offers every metric for the whole project', () => {
    expect(availableMetrics('funnel-1|', metrics).map((option) => option.value)).toEqual(['cpa_geral', 'cpa_anuncio', 'roas', 'cpl', 'cpm'])
  })

  it('offers a front its ad CPA and ROAS, but not the CPA geral of the whole project', () => {
    expect(availableMetrics('funnel-1|front-1', metrics).map((option) => option.value)).toEqual(['cpa_anuncio', 'roas', 'cpl', 'cpm'])
  })

  it('never offers CPA or ROAS on a lead project, which has no sales', () => {
    expect(availableMetrics('funnel-1|', metrics, 'lead').map((option) => option.value)).toEqual(['cpl', 'cpm'])
  })
})
