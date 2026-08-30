export interface InsightVariantStat {
  name: string
  isControl: boolean
  visits: number
  conversions: number
  revenueCents: number
  confidencePct: number | null
}

export function buildInsightPrompt(variants: InsightVariantStat[]): string {
  const lines = variants.map((variant) => {
    const rate = variant.visits > 0 ? ((variant.conversions / variant.visits) * 100).toFixed(1) : '0.0'
    const revenue = (variant.revenueCents / 100).toFixed(2)
    const confidence = variant.isControl
      ? 'controle'
      : variant.confidencePct !== null
        ? `${variant.confidencePct}% de chance de bater o controle`
        : 'dados insuficientes para calcular confiança'
    return `- ${variant.name}${variant.isControl ? ' (controle)' : ''}: ${variant.visits} visitas, ${variant.conversions} conversões (${rate}%), R$ ${revenue} de faturamento, ${confidence}`
  })

  return [
    'Você é um analista de teste A/B para um gestor de tráfego pago brasileiro.',
    'Escreva 2 a 3 frases em português, direto ao ponto, sem markdown, resumindo o resultado do teste abaixo e recomendando a próxima ação.',
    'Se a amostra de qualquer variante for pequena (menos de 100 visitas), avise que ainda é cedo para decidir em vez de recomendar declarar vencedora.',
    'Dados do teste:',
    ...lines,
  ].join('\n')
}
