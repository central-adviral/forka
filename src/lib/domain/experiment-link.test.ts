import { describe, it, expect } from 'vitest'
import { equalWeights, experimentSlug, experimentVariantName } from './experiment-link'
import { matchTestVariant } from './experiment-decision'

describe('experimentSlug', () => {
  it('builds a /r slug from the code and the title, without accents or symbols', () => {
    expect(experimentSlug('T11', 'Selo de garantia no checkout!')).toBe('t11-selo-de-garantia-no-checkout')
    expect(experimentSlug('T3', 'Preço ancorado: versão 2')).toBe('t3-preco-ancorado-versao-2')
  })

  it('keeps the slug short and never ends it on a dash', () => {
    const slug = experimentSlug('T12', 'Uma hipótese com um título comprido demais para caber num link de anúncio')
    expect(slug.length).toBeLessThanOrEqual(48)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('equalWeights', () => {
  it('splits 100 in whole numbers, the remainder on the first variants', () => {
    expect(equalWeights(2)).toEqual([50, 50])
    expect(equalWeights(3)).toEqual([34, 33, 33])
    expect(equalWeights(7).reduce((sum, weight) => sum + weight, 0)).toBe(100)
  })
})

describe('experimentVariantName', () => {
  it('names the A/B variant so the decision finds it from the card', () => {
    const name = experimentVariantName('B', 'Com selo')
    expect(name).toBe('B · Com selo')
    expect(matchTestVariant({ key: 'B', name: 'Com selo' }, [{ id: 'b', name }])).toBe('b')
  })
})
