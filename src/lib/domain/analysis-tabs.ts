export const ANALYSIS_TABS = [
  { value: 'visao', label: 'Visão geral' },
  { value: 'trafego', label: 'Tráfego' },
  { value: 'frentes', label: 'Frentes' },
  { value: 'criativos', label: 'Por criativo' },
  { value: 'origem', label: 'Origem das vendas' },
  { value: 'dias', label: 'Dia a dia' },
] as const

export type AnalysisTab = (typeof ANALYSIS_TABS)[number]['value']

export function readAnalysisTab(value: string | null | undefined): AnalysisTab {
  return ANALYSIS_TABS.find((option) => option.value === value)?.value ?? 'visao'
}
