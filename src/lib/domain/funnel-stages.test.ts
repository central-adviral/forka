import { describe, it, expect } from 'vitest'
import { DEFAULT_STAGE_PRESETS, EMPTY_TOTALS, ascensionRate, comboValue, derivedResultado, funnelResultStage, stageOfProductRole, measureOfMetric, meetsMeta, stageCost, stageRoas, sumTotals, type StageMeasure, type StageTotals } from './funnel-stages'

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

describe('funnelResultStage', () => {
  const stage = (name: string, measure: StageMeasure, extra: { parallel?: boolean; archivedAt?: string | null } = {}) => ({ name, measure, parallel: false, archivedAt: null, ...extra })

  it('is the last open stage of the sequence that is not ascensão', () => {
    const stages = [stage('Reconhecimento', 'alcance', { parallel: true }), stage('Captação', 'lead'), stage('Vendas', 'compra'), stage('Ascensão', 'ascensao')]
    expect(funnelResultStage(stages)?.name).toBe('Vendas')
  })

  it('skips archived and parallel stages, and is undefined when no stage can be the result', () => {
    expect(funnelResultStage([stage('Captação', 'lead'), stage('Vendas', 'compra', { archivedAt: '2026-10-01' })])?.name).toBe('Captação')
    expect(funnelResultStage([stage('Reconhecimento', 'alcance', { parallel: true }), stage('Ascensão', 'ascensao')])).toBeUndefined()
    expect(funnelResultStage([])).toBeUndefined()
  })
})

describe('derivedResultado', () => {
  it('takes the result stage measure', () => {
    expect(derivedResultado('compra', 'lead')).toBe('lead')
    expect(derivedResultado('lead', 'compra')).toBe('compra')
    expect(derivedResultado('compra', 'alcance')).toBe('alcance')
  })

  it('keeps ROAS and checkout in a compra stage, and the current one with no result stage', () => {
    expect(derivedResultado('roas', 'compra')).toBe('roas')
    expect(derivedResultado('checkout', 'compra')).toBe('checkout')
    expect(derivedResultado('roas', 'lead')).toBe('lead')
    expect(derivedResultado('lead', null)).toBe('lead')
    expect(derivedResultado('lead', 'ascensao')).toBe('lead')
  })
})

describe('stageOfProductRole', () => {
  const stages = [
    { id: 'v2', measure: 'compra' as const, position: 3, archivedAt: null },
    { id: 'v1', measure: 'compra' as const, position: 1, archivedAt: null },
    { id: 'old', measure: 'compra' as const, position: 0, archivedAt: '2026-10-01' },
    { id: 'asc', measure: 'ascensao' as const, position: 4, archivedAt: null },
  ]

  it('puts entrada, order bump and upsell in the first open compra stage and ascensão in the ascensao one', () => {
    expect(['entrada', 'order_bump', 'upsell', 'ascensao'].map((role) => stageOfProductRole(role, stages)?.id)).toEqual(['v1', 'v1', 'v1', 'asc'])
    expect(stageOfProductRole('ascensao', stages.slice(0, 3))).toBeUndefined()
  })
})
