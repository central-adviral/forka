import { describe, it, expect } from 'vitest'
import { FUNNEL_MODELS, firstFrontCode, modelStages, moveItem, orderPlanned, plannedStagesIssues, resultadoOf, slugify, uniqueSlug } from './new-funnel'
import { funnelResultStage } from './funnel-stages'

describe('modelStages', () => {
  it('builds each model from the built-in stages, parallel ones first', () => {
    expect(modelStages('lancamento_completo', []).map((stage) => [stage.name, stage.tag, stage.measure, stage.parallel, stage.position])).toEqual([
      ['Reconhecimento', 'REC', 'alcance', true, 0],
      ['Captação', 'CAP', 'lead', false, 1],
      ['Lembrete do evento', 'LEMB', 'alcance', false, 2],
      ['Vendas', 'VND', 'compra', false, 3],
      ['Ascensão', 'ASC', 'ascensao', false, 4],
    ])
    expect(modelStages('lancamento', []).map((stage) => stage.tag)).toEqual(['CAP', 'LEMB', 'VND'])
    expect(modelStages('perpetuo_ascensao', []).map((stage) => stage.tag)).toEqual(['VND', 'ASC'])
    expect(modelStages('perpetuo', []).map((stage) => stage.tag)).toEqual(['VND'])
  })

  it("takes the client's ready stage of the same name, accents and case ignored", () => {
    const stages = modelStages('perpetuo', [{ name: 'vendas', tag: 'VD', measure: 'compra' }])
    expect(stages).toEqual([{ name: 'vendas', tag: 'VD', measure: 'compra', parallel: false, position: 0 }])
    expect(modelStages('lancamento', [{ name: 'Captacao', tag: null, measure: 'lead' }])[0].tag).toBeNull()
  })

  it('lists the four models and "Do zero", which starts empty', () => {
    expect(FUNNEL_MODELS.map((model) => model.name)).toEqual(['Lançamento completo', 'Lançamento', 'Perpétuo + ascensão', 'Perpétuo', 'Do zero'])
    expect(modelStages('do_zero', [])).toEqual([])
  })
})

describe('resultadoOf', () => {
  it('is the measure of the last sequence stage that is not ascensão', () => {
    expect(resultadoOf(modelStages('lancamento_completo', []))).toBe('compra')
    expect(resultadoOf([{ measure: 'alcance', parallel: true }, { measure: 'lead', parallel: false }])).toBe('lead')
    expect(resultadoOf([{ measure: 'compra', parallel: false }], 'roas')).toBe('roas')
    expect(resultadoOf([], 'lead')).toBe('lead')
  })
})

describe('slugs and codes', () => {
  it('makes a free slug', () => {
    expect(slugify('Lançamento Mentoria Nov/26')).toBe('lancamento-mentoria-nov-26')
    expect(uniqueSlug('Perpétuo', ['perpetuo', 'perpetuo-2'])).toBe('perpetuo-3')
    expect(uniqueSlug('!!', [])).toBe('funil')
  })

  it('uses the stage tag as the first front code, else letters of the name', () => {
    expect(firstFrontCode({ name: 'Vendas', tag: 'VND' }, [])).toBe('VND')
    expect(firstFrontCode({ name: 'Lembrete do evento', tag: null }, [])).toBe('LEMB')
    expect(firstFrontCode({ name: 'Vendas', tag: 'VND' }, ['VND'])).toBe('VND2')
  })
})

describe('the edited stage list', () => {
  const vendas = { name: 'Vendas', tag: 'VND', measure: 'compra' as const, parallel: false }
  const rec = { name: 'Reconhecimento', tag: 'REC', measure: 'alcance' as const, parallel: true }
  const asc = { name: 'Ascensão', tag: 'ASC', measure: 'ascensao' as const, parallel: false }

  it('needs one to twelve stages, each named, with no repeated tag', () => {
    expect(plannedStagesIssues([vendas])).toEqual([])
    expect(plannedStagesIssues([])).toEqual(['monte ao menos uma etapa'])
    expect(plannedStagesIssues(Array.from({ length: 13 }, (_, i) => ({ name: `E${i}`, tag: null })))).toEqual(['até 12 etapas por funil'])
    expect(plannedStagesIssues([vendas, { name: '  ', tag: null }])).toEqual(['dê um nome para cada etapa'])
    expect(plannedStagesIssues([vendas, { ...vendas, tag: 'vnd' }, { name: 'Sem', tag: null }, { name: 'Sem 2', tag: null }])).toEqual(['etiqueta VND repetida'])
  })

  it('creates parallel stages first, then the sequence, with their positions', () => {
    expect(orderPlanned([vendas, rec, asc]).map((stage) => [stage.name, stage.position])).toEqual([
      ['Reconhecimento', 0],
      ['Vendas', 1],
      ['Ascensão', 2],
    ])
  })

  it('previews the result stage: the last of the sequence that is not ascensão', () => {
    const planned = orderPlanned([vendas, rec, asc])
    expect(funnelResultStage(planned.map((stage) => ({ ...stage, archivedAt: null })))?.name).toBe('Vendas')
    expect(funnelResultStage(orderPlanned([rec]).map((stage) => ({ ...stage, archivedAt: null })))).toBeUndefined()
  })

  it('moves a stage one step and leaves the edges alone', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    const list = ['a', 'b']
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 1, 1)).toBe(list)
  })
})
