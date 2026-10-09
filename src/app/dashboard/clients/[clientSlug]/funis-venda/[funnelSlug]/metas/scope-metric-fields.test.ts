import { describe, it, expect } from 'vitest'
import { availableMetrics } from './scope-metric-fields'

const metrics = [
  { value: 'cpa_geral', label: 'CPA geral', projectOnly: true, salesOnly: true },
  { value: 'cpa_anuncio', label: 'CPA de anúncio', projectOnly: false, salesOnly: true },
  { value: 'roas', label: 'ROAS', projectOnly: false, salesOnly: true },
  { value: 'cpl', label: 'CPL', projectOnly: false, salesOnly: false },
]
const values = (scope: string, sales = true) => availableMetrics(scope, metrics, sales).map((option) => option.value)

describe('availableMetrics', () => {
  it('offers every metric for the whole funnel', () => {
    expect(values('funil')).toEqual(['cpa_geral', 'cpa_anuncio', 'roas', 'cpl'])
  })

  it('offers a stage its own CPA geral (the sales the stage counts), not the ad CPA of a front', () => {
    expect(values('etapa:s1')).toEqual(['cpa_geral', 'roas', 'cpl'])
  })

  it('offers a front its ad CPA and ROAS, not the CPA geral', () => {
    expect(values('frente:f1')).toEqual(['cpa_anuncio', 'roas', 'cpl'])
  })

  it('never offers CPA or ROAS when the funnel result counts no sales', () => {
    expect(values('funil', false)).toEqual(['cpl'])
  })
})
