// What a project's numbers are made of and what is left out of them (0092): the "de onde vem esse
// número" lines under the KPIs and the quality seals next to the project's title.

export interface ProjectQualityRow {
  vendas_entrada: number
  vendas_anuncio: number
  vendas_anuncio_sem_id: number
  vendas_sem_utm: number
  vendas_bio: number
  vendas_outra_origem: number
  cliente_vendas_sem_projeto: number
  cliente_gasto_sem_frente: number
  cliente_campanhas_sem_frente: number
  cliente_campanhas_em_disputa: number
  espelhos_sem_janela: number
  vigias_sem_avaliar: number
}

export interface QualitySeal {
  label: string
  detail: string
  tone: 'crit' | 'warn'
  href: string
}

export interface SourceLine {
  label: string
  value: string
}

const n = (value: number) => Number(value).toLocaleString('pt-BR')
const brl = (value: number) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const plural = (count: number, one: string, many: string) => `${n(count)} ${Number(count) === 1 ? one : many}`

/** Seals only for what is wrong; each one links to the screen that fixes it. */
export function qualitySeals(row: ProjectQualityRow, links: { regras: string; produtos: string; edit: string; metas: string }): QualitySeal[] {
  const seals: QualitySeal[] = []
  if (Number(row.cliente_campanhas_em_disputa) > 0)
    seals.push({
      label: plural(row.cliente_campanhas_em_disputa, 'campanha em disputa', 'campanhas em disputa'),
      detail: 'O nome bate com mais de uma frente: o gasto não conta em nenhum projeto até alguém escolher.',
      tone: 'crit',
      href: links.regras,
    })
  if (Number(row.cliente_gasto_sem_frente) > 0)
    seals.push({
      label: `${brl(row.cliente_gasto_sem_frente)} sem frente`,
      detail: `${plural(row.cliente_campanhas_sem_frente, 'campanha do cliente gasta', 'campanhas do cliente gastam')} sem frente: fora do CPA de todo projeto.`,
      tone: 'warn',
      href: links.regras,
    })
  if (Number(row.cliente_vendas_sem_projeto) > 0)
    seals.push({
      label: plural(row.cliente_vendas_sem_projeto, 'venda sem projeto', 'vendas sem projeto'),
      detail: 'Vendas do cliente que nenhum projeto pegou: o produto está em mais de um projeto e a UTM não diz o anúncio.',
      tone: 'warn',
      href: links.produtos,
    })
  if (Number(row.espelhos_sem_janela) > 0)
    seals.push({
      label: plural(row.espelhos_sem_janela, 'frente espelho sem janela', 'frentes espelho sem janela'),
      detail: 'Sem data de início e fim, o espelho soma todos os dias do outro projeto.',
      tone: 'warn',
      href: links.edit,
    })
  if (Number(row.vigias_sem_avaliar) > 0)
    seals.push({
      label: plural(row.vigias_sem_avaliar, 'vigia que não avalia', 'vigias que não avaliam'),
      detail: 'Sem dado ou sem avaliação há mais de 2 dias: parece saudável, mas não está olhando.',
      tone: 'warn',
      href: links.metas,
    })
  return seals
}

/** The CPA geral and CPA de anúncio, spelled out: what counts and what is left out. */
export function cpaSources(row: ProjectQualityRow, cross?: { geradas_para_outro: number; vindas_de_outro: number }): SourceLine[] {
  const entries = Number(row.vendas_entrada)
  const fromAds = Number(row.vendas_anuncio)
  const lines: SourceLine[] = [
    { label: 'Vendas de entrada (CPA geral)', value: n(entries) },
    { label: 'de anúncio, com a campanha identificada (CPA de anúncio e por frente)', value: n(fromAds) },
  ]
  const outside = [
    Number(row.vendas_anuncio_sem_id) > 0 ? `${n(row.vendas_anuncio_sem_id)} anúncio sem identificação` : null,
    Number(row.vendas_sem_utm) > 0 ? `${n(row.vendas_sem_utm)} sem UTM` : null,
    Number(row.vendas_bio) > 0 ? `${n(row.vendas_bio)} da bio` : null,
    Number(row.vendas_outra_origem) > 0 ? `${n(row.vendas_outra_origem)} de outra origem` : null,
  ].filter(Boolean)
  if (entries > fromAds && outside.length > 0) lines.push({ label: 'fora do CPA de anúncio', value: outside.join(' · ') })
  if (Number(row.cliente_vendas_sem_projeto) > 0) lines.push({ label: 'do cliente, sem projeto (fora deste CPA)', value: n(row.cliente_vendas_sem_projeto) })
  // A product only another project sells stays there; the ad that brought the buyer is still shown (0095).
  if (cross && Number(cross.vindas_de_outro) > 0) lines.push({ label: 'vieram de anúncio de outro projeto (contam aqui)', value: n(cross.vindas_de_outro) })
  if (cross && Number(cross.geradas_para_outro) > 0) lines.push({ label: 'geradas para outro projeto (contam lá)', value: n(cross.geradas_para_outro) })
  return lines
}
