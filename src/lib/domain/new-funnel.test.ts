import { describe, it, expect } from 'vitest'
import { FUNNEL_MODELS, firstFrontCode, modelStages, resultadoOf, slugify, uniqueSlug } from './new-funnel'

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

  it('lists the four models', () => {
    expect(FUNNEL_MODELS.map((model) => model.name)).toEqual(['Lançamento completo', 'Lançamento', 'Perpétuo + ascensão', 'Perpétuo'])
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
