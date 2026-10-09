import { describe, it, expect } from 'vitest'
import { DEFAULT_STAGE_PRESETS, EMPTY_TOTALS, ascensionRate, comboValue, measureOfMetric, meetsMeta, stageCost, stageRoas, sumTotals, type StageTotals } from './funnel-stages'

const totals = (values: Partial<StageTotals>): StageTotals => ({ ...EMPTY_TOTALS, ...values })

describe('measureOfMetric', () => {
  it('puts CPA, ROAS and checkout in the sale stage and keeps the others', () => {
    expect(measureOfMetric('compra')).toBe('compra')
    expect(measureOfMetric('roas')).toBe('compra')
    expect(measureOfMetric('checkout')).toBe('compra')
    expect(measureOfMetric('lead')).toBe('lead')
    expect(measureOfMetric('visita')).toBe('visita')
    expect(measureOfMetric('alcance')).toBe('alcance')
  })
})

describe('stageCost', () => {
  it('prices each measure by its own result', () => {
    expect(stageCost('alcance', totals({ spendComImposto: 30, impressions: 2000 }))).toBe(15)
    expect(stageCost('lead', totals({ spendComImposto: 100, leads: 25 }))).toBe(4)
    expect(stageCost('visita', totals({ spendComImposto: 50, landingPageViews: 100 }))).toBe(0.5)
    expect(stageCost('compra', totals({ spendComImposto: 600, vendas: 5 }))).toBe(120)
  })

  it('is null when nothing was produced', () => {
    expect(stageCost('lead', totals({ spendComImposto: 100 }))).toBeNull()
    expect(stageCost('alcance', totals({ spendComImposto: 100 }))).toBeNull()
  })

  it('gives ascensão the rate over the entry buyers', () => {
    expect(stageCost('ascensao', totals({ vendas: 3 }), 30)).toBe(0.1)
    expect(stageCost('ascensao', totals({ vendas: 3 }))).toBeNull()
    expect(ascensionRate(1, 4)).toBe(0.25)
  })
})

describe('stageRoas and meetsMeta', () => {
  it('reads net revenue over spend and judges costs as ceilings, the rate as a floor', () => {
    expect(stageRoas(totals({ spendComImposto: 100, receitaLiquida: 250 }))).toBe(2.5)
    expect(stageRoas(totals({ receitaLiquida: 250 }))).toBeNull()
    expect(meetsMeta('compra', 110, 120)).toBe(true)
    expect(meetsMeta('compra', 130, 120)).toBe(false)
    expect(meetsMeta('ascensao', 0.1, 0.08)).toBe(true)
    expect(meetsMeta('lead', null, 4)).toBeNull()
    expect(meetsMeta('lead', 3, null)).toBeNull()
  })
})

describe('sumTotals', () => {
  it('adds the days of a stage', () => {
    expect(sumTotals([totals({ spendComImposto: 10, leads: 1 }), totals({ spendComImposto: 5, leads: 2, vendas: 1 })])).toEqual(
      totals({ spendComImposto: 15, leads: 3, vendas: 1 })
    )
  })
})

describe('comboValue', () => {
  const stages = [
    { id: 'cap', measure: 'lead' as const },
    { id: 'vnd', measure: 'compra' as const },
  ]
  const byStage = new Map([
    ['cap', totals({ spendComImposto: 400, leads: 100 })],
    ['vnd', totals({ spendComImposto: 200, vendas: 5, receitaLiquida: 1500 })],
  ])

  it('sums the chosen stages over one stage result: the old CPA geral', () => {
    expect(comboValue({ stageIds: ['cap', 'vnd'], over: 'stage', overStageId: 'vnd' }, stages, byStage, 1500)).toEqual({ kind: 'cost', value: 120 })
  })

  it('sums the chosen stages over revenue as a ROAS', () => {
    expect(comboValue({ stageIds: ['cap', 'vnd'], over: 'receita', overStageId: null }, stages, byStage, 1500)).toEqual({ kind: 'roas', value: 2.5 })
  })

  it('is null without the stage or without spend', () => {
    expect(comboValue({ stageIds: ['cap'], over: 'stage', overStageId: 'gone' }, stages, byStage, 0).value).toBeNull()
    expect(comboValue({ stageIds: ['none'], over: 'receita', overStageId: null }, stages, byStage, 100).value).toBeNull()
  })
})

describe('DEFAULT_STAGE_PRESETS', () => {
  it('lists the journey in order with Reconhecimento alongside it', () => {
    expect(DEFAULT_STAGE_PRESETS.map((preset) => preset.tag)).toEqual(['REC', 'CAP', 'LEMB', 'AQC', 'VND', 'RCAR', 'ASC'])
    expect(DEFAULT_STAGE_PRESETS.filter((preset) => preset.parallel).map((preset) => preset.name)).toEqual(['Reconhecimento'])
  })
})
