import { describe, it, expect } from 'vitest'
import { buildInsightPrompt, type InsightVariantStat } from './insight-prompt'

describe('buildInsightPrompt', () => {
  it('includes formatted stats for each variant', () => {
    const variants: InsightVariantStat[] = [
      { name: 'Controle', isControl: true, visits: 1204, conversions: 58, revenueCents: 580000, confidencePct: null },
      { name: 'Variante B', isControl: false, visits: 1189, conversions: 79, revenueCents: 790000, confidencePct: 91 },
    ]
    const prompt = buildInsightPrompt(variants)
    expect(prompt).toContain(
      '- Controle (controle): 1204 visitas, 58 conversões (4.8%), R$ 5800.00 de faturamento, controle'
    )
    expect(prompt).toContain(
      '- Variante B: 1189 visitas, 79 conversões (6.6%), R$ 7900.00 de faturamento, 91% de chance de bater o controle'
    )
  })

  it('flags insufficient data when confidence could not be computed', () => {
    const variants: InsightVariantStat[] = [
      { name: 'Controle', isControl: true, visits: 0, conversions: 0, revenueCents: 0, confidencePct: null },
      { name: 'Variante B', isControl: false, visits: 5, conversions: 0, revenueCents: 0, confidencePct: null },
    ]
    const prompt = buildInsightPrompt(variants)
    expect(prompt).toContain('dados insuficientes para calcular confiança')
  })

  it('instructs the model to write in portuguese, without markdown, and to warn on small samples', () => {
    const prompt = buildInsightPrompt([])
    expect(prompt).toContain('português')
    expect(prompt).toContain('sem markdown')
    expect(prompt).toContain('100 visitas')
  })
})
