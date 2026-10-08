export interface InsightVariantStat {
  name: string
  isControl: boolean
  visits: number
  conversions: number
  revenueCents: number
  confidencePct: number | null
}

/** What the report's trust seal knows, so the model never recommends deciding a test that is not ready. */
export interface InsightQuality {
  /** The seal's own words: why the read can or cannot be trusted yet. */
  trust: string
  trustworthy: boolean
  daysRunning: number
  /** People each live side needs; null while the control has no conversion. */
  neededPerArm: number | null
  /** The test belongs to a project, so its sales are counted only inside that project. */
  ownLayer: boolean
}

export function buildInsightPrompt(variants: InsightVariantStat[], quality?: InsightQuality): string {
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
    ...(quality
      ? [
          `Qualidade da leitura: ${quality.trustworthy ? 'confiável' : 'ainda não confiável'}. ${quality.trust}`,
          `Dias rodando: ${quality.daysRunning}. Amostra mínima por variante: ${quality.neededPerArm !== null ? quality.neededPerArm : 'ainda sem cálculo (o controle não converteu)'}.`,
          quality.ownLayer
            ? 'O teste está num projeto: só as vendas desse projeto contam para ele.'
            : 'O teste não está num projeto: a mesma venda pode ter contado em outro teste do cliente.',
          'Se a leitura não for confiável, diga o que falta e recomende continuar rodando, nunca declarar vencedora.',
        ]
      : []),
    'Dados do teste:',
    ...lines,
  ].join('\n')
}
