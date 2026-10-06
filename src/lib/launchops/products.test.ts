import { describe, it, expect } from 'vitest'
import { summarizeProducts } from './products'

describe('summarizeProducts', () => {
  it('counts sales and the average ticket per product across platforms, busiest first', () => {
    const products = summarizeProducts([
      { produto_nome: 'Mentoria', plataforma: 'hubla', valor_bruto: 100 },
      { produto_nome: '1K', plataforma: 'hubla', valor_bruto: 8 },
      { produto_nome: '1K', plataforma: 'pagtrust', valor_bruto: '10' },
      { produto_nome: null, plataforma: 'hubla', valor_bruto: 5 },
    ])
    expect(products).toEqual([
      { produto_nome: '1K', plataformas: ['hubla', 'pagtrust'], vendas: 2, ticket: 9 },
      { produto_nome: 'Mentoria', plataformas: ['hubla'], vendas: 1, ticket: 100 },
    ])
  })
})
