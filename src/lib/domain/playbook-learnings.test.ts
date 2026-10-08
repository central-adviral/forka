import { describe, it, expect } from 'vitest'
import { PLAYBOOK, playbookStep } from './playbook'
import { similarLearnings } from './similar-learnings'

describe('playbookStep', () => {
  it('follows the calendar: subir, primeiros cliques, sorteio, primeira leitura, decidir', () => {
    expect([0, 1, 2, 3, 6, 7, 9, 10, 25].map((day) => PLAYBOOK[playbookStep(day)].label.split(' ')[0])).toEqual([
      'D0', 'D1', 'D1', 'D3', 'D3', 'D7', 'D7', 'D10–21', 'D10–21',
    ])
  })
})

describe('similarLearnings', () => {
  const learnings = [
    { code: 'T3', title: 'Garantia no rodapé', learning: 'A garantia no rodapé não mudou a conversão.', result: '−1%' },
    { code: 'T5', title: 'Preço ancorado na página', learning: 'Mostrar o preço cheio antes da oferta reduz a objeção.', result: '+21%' },
    { code: 'T6', title: 'Criativo UGC vs estúdio', learning: 'UGC traz CPA menor no público frio.', result: null },
  ]

  it('finds the decided tests about the same thing, ignoring accents and common words', () => {
    expect(similarLearnings('Selo de garantia acima do formulário', learnings).map((learning) => learning.code)).toEqual(['T3'])
    expect(similarLearnings('Preco riscado no checkout', learnings).map((learning) => learning.code)).toEqual(['T5'])
  })

  it('says nothing for a title with no meaningful word in common', () => {
    expect(similarLearnings('Nova página de obrigado', learnings)).toEqual([])
    expect(similarLearnings('', learnings)).toEqual([])
  })
})
