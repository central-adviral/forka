import { PROJECT_RESULTS, type ProjectResult } from './project-plan'
import { pageKey, MAX_PAGES_PER_CLIENT } from './page-probe'
import type { ProductRole } from './product-roles'

// "Projeto por Frentes" (0102): the four-step project creation. Pure state and checks, shared by the
// wizard on screen and by the server action that saves it, so both judge the same seals.

export type ProjectModel = 'pago' | 'gratuito' | 'perpetuo' | 'captacao'
export type PageKind = 'captura' | 'obrigado' | 'vendas' | 'checkout'
export type ProjectStatus = 'rascunho' | 'rodando' | 'encerrado'

export const METRIC_KEYS = Object.keys(PROJECT_RESULTS) as ProjectResult[]
export const PAGE_KINDS: PageKind[] = ['captura', 'obrigado', 'vendas', 'checkout']
export const PAGE_KIND_LABEL: Record<PageKind, string> = { captura: 'Captura', obrigado: 'Obrigado', vendas: 'Vendas', checkout: 'Checkout' }

/** A starting target per metric; the gestor changes it on the first screen. */
export const DEFAULT_TARGET: Record<ProjectResult, number> = { compra: 120, lead: 4, roas: 2.5, checkout: 40, visita: 1, alcance: 15 }

export interface WizardPage {
  kind: PageKind
  url: string
  /** Copied from another project: the address is probably the old one. */
  review?: boolean
}

export interface WizardFront {
  key: string
  name: string
  code: string
  kind: 'propria' | 'espelho'
  tag: string
  tagEdited: boolean
  /** The project a mirror front reads. */
  sourceProjectId: string | null
  /** A mirror's own date window (YYYY-MM-DD, '' when empty): it reads spend only inside it. */
  windowStart: string
  windowEnd: string
  /** Own metrics: off follows the project and has no alert of its own. */
  own: boolean
  primary: ProjectResult
  primaryTarget: number
  secondary: ProjectResult
  secondaryTarget: number
  pages: WizardPage[]
}

export interface WizardProject {
  name: string
  slug: string
  slugEdited: boolean
  model: ProjectModel | null
  primary: ProjectResult
  primaryTarget: number
  secondary: ProjectResult
  secondaryTarget: number
  startsOn: string
  endsOn: string
  fronts: WizardFront[]
  products: Record<string, ProductRole>
  duplicatedFrom: string | null
  /** The project duplicated from: its stages and cost combos are copied too (0105). */
  duplicatedFromId: string | null
}

interface FrontPreset {
  name: string
  code: string
  own: boolean
  primary: ProjectResult
  secondary: ProjectResult
  pages: PageKind[]
}

export const MODELS: Record<ProjectModel, { label: string; text: string; primary: ProjectResult; secondary: ProjectResult; fronts: FrontPreset[] }> = {
  pago: {
    label: 'Lançamento pago',
    text: 'Captação paga e abertura de carrinho.',
    primary: 'compra',
    secondary: 'lead',
    fronts: [
      { name: 'Captação', code: 'CAP', own: true, primary: 'lead', secondary: 'alcance', pages: ['captura', 'obrigado'] },
      { name: 'Vendas', code: 'VND', own: false, primary: 'compra', secondary: 'roas', pages: ['vendas'] },
    ],
  },
  gratuito: {
    label: 'Lançamento gratuito',
    text: 'Captação para evento e aquecimento.',
    primary: 'lead',
    secondary: 'alcance',
    fronts: [
      { name: 'Captação', code: 'CAP', own: false, primary: 'lead', secondary: 'visita', pages: ['captura'] },
      { name: 'Aquecimento', code: 'AQC', own: true, primary: 'alcance', secondary: 'visita', pages: [] },
    ],
  },
  perpetuo: {
    label: 'Perpétuo',
    text: 'Venda direta contínua.',
    primary: 'roas',
    secondary: 'compra',
    fronts: [
      { name: 'Público frio', code: 'FRIO', own: false, primary: 'compra', secondary: 'roas', pages: ['vendas'] },
      { name: 'Remarketing', code: 'RMKT', own: false, primary: 'roas', secondary: 'compra', pages: [] },
    ],
  },
  captacao: {
    label: 'Captação e aquecimento',
    text: 'Lista e audiência, sem venda agora.',
    primary: 'lead',
    secondary: 'visita',
    fronts: [
      { name: 'Captação', code: 'CAP', own: false, primary: 'lead', secondary: 'visita', pages: ['captura'] },
      { name: 'Conteúdo', code: 'CONT', own: true, primary: 'alcance', secondary: 'visita', pages: [] },
    ],
  },
}

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** "1K LATAM" -> "1k-latam": the project's internal address. */
export function slugify(name: string): string {
  return plain(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** The project's short tag: one word keeps its first 4 letters, several take 2 + the initials ("1K LATAM" -> "1KL"). */
export function projectTag(name: string): string {
  const words = plain(name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  if (words.length === 0) return 'PRJ'
  return (words.length === 1 ? words[0].slice(0, 4) : words.map((word, index) => (index === 0 ? word.slice(0, 2) : word[0])).join('')).slice(0, 4)
}

export const frontTag = (projectName: string, code: string) => `[${projectTag(projectName)}][${code}]`

let frontSeq = 0
export function newFront(projectName: string, preset: Partial<FrontPreset> & { name: string; code: string }, fallback: { primary: ProjectResult; secondary: ProjectResult }): WizardFront {
  const primary = preset.primary ?? fallback.primary
  const secondary = preset.secondary ?? fallback.secondary
  return {
    key: `f${frontSeq++}`,
    name: preset.name,
    code: preset.code,
    kind: 'propria',
    tag: frontTag(projectName, preset.code),
    tagEdited: false,
    sourceProjectId: null,
    windowStart: '',
    windowEnd: '',
    own: preset.own ?? false,
    primary,
    primaryTarget: DEFAULT_TARGET[primary],
    secondary,
    secondaryTarget: DEFAULT_TARGET[secondary],
    pages: (preset.pages ?? []).map((kind) => ({ kind, url: '' })),
  }
}

export function emptyProject(): WizardProject {
  return applyModel({ name: '', slug: '', slugEdited: false, model: null, primary: 'compra', primaryTarget: 0, secondary: 'lead', secondaryTarget: 0, startsOn: '', endsOn: '', fronts: [], products: {}, duplicatedFrom: null, duplicatedFromId: null }, 'pago')
}

/** A model only pre-fills: metrics, targets and fronts with their pages. Name and dates stay. */
export function applyModel(project: WizardProject, model: ProjectModel): WizardProject {
  const preset = MODELS[model]
  return {
    ...project,
    model,
    primary: preset.primary,
    primaryTarget: DEFAULT_TARGET[preset.primary],
    secondary: preset.secondary,
    secondaryTarget: DEFAULT_TARGET[preset.secondary],
    fronts: preset.fronts.map((front) => newFront(project.name, front, preset)),
    duplicatedFrom: null,
    duplicatedFromId: null,
  }
}

/** A name change carries to the address and to every tag the gestor did not type himself. */
export function rename(project: WizardProject, name: string): WizardProject {
  return {
    ...project,
    name,
    slug: project.slugEdited ? project.slug : slugify(name),
    fronts: project.fronts.map((front) => (front.tagEdited ? front : { ...front, tag: frontTag(name, front.code) })),
  }
}

export const metricLabel = (metric: ProjectResult) => PROJECT_RESULTS[metric].cost

/** The metrics a front is judged by: its own when switched on, the project's otherwise. */
export function frontMetrics(project: WizardProject, front: WizardFront) {
  return front.own
    ? { primary: front.primary, primaryTarget: front.primaryTarget, secondary: front.secondary, secondaryTarget: front.secondaryTarget, own: true }
    : { primary: project.primary, primaryTarget: project.primaryTarget, secondary: project.secondary, secondaryTarget: project.secondaryTarget, own: false }
}

/** CPA and ROAS need sales: then the project needs an entry product. */
export function needsProducts(project: WizardProject): boolean {
  return [project.primary, project.secondary, ...project.fronts.filter((front) => front.own).flatMap((front) => [front.primary, front.secondary])].some(
    (metric) => PROJECT_RESULTS[metric].sales
  )
}

export interface PreviewCampaign {
  campaign_name: string
  spend: number
  /** The campaign's owner front today, if any (get_client_campaigns). */
  owner_project: string | null
}

const lower = (text: string) => text.normalize('NFC').toLowerCase()

/** Campaigns whose name contains the tag: the same "contém" the naming rule will apply (0053). */
export function matchTag(tag: string, campaigns: PreviewCampaign[]): PreviewCampaign[] {
  const needle = lower(tag.trim())
  if (!needle) return []
  return campaigns.filter((campaign) => lower(campaign.campaign_name).includes(needle))
}

export interface FrontPreview {
  campaigns: PreviewCampaign[]
  spend: number
  /** Also taken by another front of this project. */
  disputed: PreviewCampaign[]
  /** Owned today by a front of another project. */
  foreign: PreviewCampaign[]
}

export function previewFront(project: WizardProject, front: WizardFront, campaigns: PreviewCampaign[]): FrontPreview {
  if (front.kind === 'espelho') return { campaigns: [], spend: 0, disputed: [], foreign: [] }
  const taken = matchTag(front.tag, campaigns)
  const others = project.fronts.filter((other) => other.key !== front.key && other.kind === 'propria' && other.tag.trim())
  return {
    campaigns: taken,
    spend: taken.reduce((sum, campaign) => sum + Number(campaign.spend), 0),
    disputed: taken.filter((campaign) => others.some((other) => lower(campaign.campaign_name).includes(lower(other.tag.trim())))),
    foreign: taken.filter((campaign) => campaign.owner_project !== null),
  }
}

export interface ExistingPage {
  url: string
  /** "Projeto · Frente", where the page lives today. */
  where: string
}

/** Where else this page already is: a page lives in one front only, by address (0093). */
export function pageConflict(project: WizardProject, frontIndex: number, pageIndex: number, existing: ExistingPage[]): string | null {
  const key = pageKey(project.fronts[frontIndex].pages[pageIndex].url.trim())
  if (!key) return null
  const known = existing.find((page) => pageKey(page.url) === key)
  if (known) return known.where
  for (const [otherIndex, front] of project.fronts.entries()) {
    for (const [otherPage, page] of front.pages.entries()) {
      if ((otherIndex !== frontIndex || otherPage !== pageIndex) && pageKey(page.url.trim()) === key) return `Frente ${front.name}`
    }
  }
  return null
}

export type Coherence =
  | { kind: 'cpl_cpa'; cpl: number; cpa: number; conversionPct: number; projectedCpa: number; ok: boolean; neededCpl: number; neededConversionPct: number }
  | { kind: 'roas_cpa'; roas: number; cpa: number; ticket: number; maxCpa: number; ok: boolean }

const pairIs = (project: WizardProject, a: ProjectResult, b: ProjectResult) =>
  (project.primary === a && project.secondary === b) || (project.primary === b && project.secondary === a)
const targetOf = (project: WizardProject, metric: ProjectResult) => (project.primary === metric ? project.primaryTarget : project.secondaryTarget)

/**
 * Whether the two targets can both be met. CPL + CPA: each sale costs the leads it took, so
 * CPL ÷ conversion is the CPA the CPL delivers. ROAS + CPA: ticket ÷ ROAS is the most a sale can cost.
 */
export function coherence(project: WizardProject, conversionPct: number, ticket: number): Coherence | null {
  if (pairIs(project, 'compra', 'lead')) {
    const cpl = targetOf(project, 'lead')
    const cpa = targetOf(project, 'compra')
    const conversion = conversionPct / 100
    const projectedCpa = conversion > 0 ? cpl / conversion : Infinity
    return { kind: 'cpl_cpa', cpl, cpa, conversionPct, projectedCpa, ok: projectedCpa <= cpa, neededCpl: cpa * conversion, neededConversionPct: cpa > 0 ? (cpl / cpa) * 100 : Infinity }
  }
  if (pairIs(project, 'roas', 'compra')) {
    const roas = targetOf(project, 'roas')
    const cpa = targetOf(project, 'compra')
    const maxCpa = roas > 0 ? ticket / roas : Infinity
    return { kind: 'roas_cpa', roas, cpa, ticket, maxCpa, ok: cpa <= maxCpa }
  }
  return null
}

export type SealTone = 'crit' | 'warn' | 'info'
export interface Seal {
  tone: SealTone
  text: string
  /** The step that fixes it: 0 Projeto, 1 Frentes, 2 Produtos. */
  step: number
  /** A draft can be saved with it; only "Ligar" waits for it. */
  draftOk?: true
}

export interface SealContext {
  campaigns: PreviewCampaign[]
  existingPages: ExistingPage[]
  /** Active pages the client already has in the probe. */
  activePages: number
  takenSlugs: string[]
}

/** What is still missing, by severity: a critical seal blocks "Ligar projeto". */
export function seals(project: WizardProject, context: SealContext): Seal[] {
  const out: Seal[] = []
  if (!project.name.trim()) out.push({ tone: 'crit', text: 'Funil sem nome.', step: 0 })
  if (!project.slug) out.push({ tone: 'crit', text: 'Funil sem endereço interno.', step: 0 })
  else if (context.takenSlugs.includes(project.slug)) out.push({ tone: 'crit', text: `Já existe um funil com o endereço /${project.slug}.`, step: 0 })
  if (project.primary === project.secondary) out.push({ tone: 'crit', text: 'A métrica secundária precisa ser diferente da principal.', step: 0 })
  if (!(project.primaryTarget > 0) || !(project.secondaryTarget > 0)) out.push({ tone: 'crit', text: 'Preencha as metas da métrica principal e da secundária.', step: 0, draftOk: true })
  if (project.startsOn && project.endsOn && project.endsOn < project.startsOn) out.push({ tone: 'crit', text: 'O fim do funil vem antes do início.', step: 0 })
  if (project.fronts.length === 0) out.push({ tone: 'crit', text: 'Funil sem frente: não há de onde vir o gasto.', step: 1, draftOk: true })
  const codes = project.fronts.map((front) => front.code.trim().toUpperCase())
  project.fronts.forEach((front, index) => {
    if (!front.code.trim() || !front.name.trim()) out.push({ tone: 'crit', text: `Frente ${index + 1} sem nome ou código.`, step: 1 })
    else if (codes.indexOf(codes[index]) !== index) out.push({ tone: 'crit', text: `Duas frentes com o código ${codes[index]}.`, step: 1 })
    const preview = previewFront(project, front, context.campaigns)
    if (front.kind === 'propria') {
      if (!front.tag.trim()) out.push({ tone: 'crit', text: `Frente ${front.name} sem etiqueta.`, step: 1, draftOk: true })
      else if (preview.disputed.length) out.push({ tone: 'crit', text: `Frente ${front.name}: ${preview.disputed.length} campanha(s) em duas frentes.`, step: 1, draftOk: true })
      else if (preview.foreign.length) out.push({ tone: 'warn', text: `Frente ${front.name} pega campanha de ${preview.foreign[0].owner_project}.`, step: 1 })
      else if (!preview.campaigns.length) out.push({ tone: 'info', text: `Frente ${front.name} aguardando campanhas com ${front.tag.trim()}.`, step: 1 })
      if (preview.campaigns.length && !front.pages.some((page) => page.url.trim())) out.push({ tone: 'warn', text: `Frente ${front.name} recebe anúncio e não tem página vigiada.`, step: 1 })
    } else {
      if (!front.sourceProjectId) out.push({ tone: 'crit', text: `Frente espelho ${front.name} sem funil de origem.`, step: 1 })
      if (!front.windowStart || !front.windowEnd) out.push({ tone: 'crit', text: `Frente espelho ${front.name} sem janela de datas.`, step: 1, draftOk: true })
      else if (front.windowEnd < front.windowStart) out.push({ tone: 'crit', text: `Frente espelho ${front.name}: o fim da janela vem antes do início.`, step: 1 })
    }
    if (front.own && front.primary === front.secondary) out.push({ tone: 'crit', text: `Frente ${front.name}: a métrica secundária precisa ser diferente da principal.`, step: 1 })
    if (front.own && (!(front.primaryTarget > 0) || !(front.secondaryTarget > 0))) out.push({ tone: 'crit', text: `Frente ${front.name}: preencha as metas das métricas próprias.`, step: 1, draftOk: true })
    if (front.pages.some((_, pageIndex) => pageConflict(project, index, pageIndex, context.existingPages))) {
      out.push({ tone: 'crit', text: `Frente ${front.name} tem página que já está em outra frente.`, step: 1 })
    }
    if (front.pages.some((page) => page.review && page.url.trim())) out.push({ tone: 'warn', text: `Frente ${front.name}: revise as páginas copiadas.`, step: 1 })
  })
  const newPages = project.fronts.filter((front) => front.kind === 'propria').flatMap((front) => front.pages).filter((page) => page.url.trim()).length
  if (context.activePages + newPages > MAX_PAGES_PER_CLIENT) {
    out.push({ tone: 'crit', text: `A sonda acompanha até ${MAX_PAGES_PER_CLIENT} páginas por cliente; este funil passaria de ${context.activePages + newPages}.`, step: 1 })
  }
  if (needsProducts(project) && !Object.values(project.products).includes('entrada')) {
    out.push({ tone: 'crit', text: 'Uma métrica escolhida depende de venda (CPA ou ROAS) e não há produto de entrada.', step: 2, draftOk: true })
  }
  return out
}

export const isBlocked = (list: Seal[]) => list.some((seal) => seal.tone === 'crit')
export const blocksDraft = (list: Seal[]) => list.some((seal) => seal.tone === 'crit' && !seal.draftOk)

export interface SourceProject {
  id: string
  name: string
  modelo: ProjectModel | null
  resultado: ProjectResult
  metricaSecundaria: ProjectResult | null
  primaryTarget: number | null
  secondaryTarget: number | null
  fronts: {
    code: string
    name: string
    sourceProjectId: string | null
    includes: string[]
    primary: ProjectResult | null
    primaryTarget: number | null
    secondary: ProjectResult | null
    secondaryTarget: number | null
    pages: { url: string; tipo: PageKind | null }[]
  }[]
  products: { produto_nome: string; papel: ProductRole }[]
}

/**
 * "Duplicar de um projeto anterior": fronts, metrics, targets, products and pages. The old project's
 * tag in each front's rule becomes the new project's; pages come marked for review. A mirror's
 * window is not copied: the old dates belong to the old project.
 */
export function duplicateProject(project: WizardProject, source: SourceProject): WizardProject {
  const name = project.name.trim() ? project.name : `${source.name} (cópia)`
  const oldTag = new RegExp(`\\[${projectTag(source.name)}\\]`, 'i')
  const newTag = `[${projectTag(name)}]`
  const secondary = source.metricaSecundaria ?? METRIC_KEYS.find((metric) => metric !== source.resultado)!
  const fronts = source.fronts.map((front): WizardFront => {
    const base = newFront(name, { name: front.name, code: front.code }, { primary: source.resultado, secondary })
    const tag = (front.includes[0] ?? '').replace(oldTag, newTag) || base.tag
    return {
      ...base,
      kind: front.sourceProjectId ? 'espelho' : 'propria',
      sourceProjectId: front.sourceProjectId,
      tag,
      tagEdited: tag !== base.tag,
      own: front.primary !== null,
      primary: front.primary ?? base.primary,
      primaryTarget: front.primaryTarget ?? base.primaryTarget,
      secondary: front.secondary ?? base.secondary,
      secondaryTarget: front.secondaryTarget ?? base.secondaryTarget,
      pages: front.pages.map((page) => ({ kind: page.tipo ?? 'vendas', url: page.url, review: true })),
    }
  })
  return {
    ...rename(project, name),
    model: source.modelo,
    primary: source.resultado,
    primaryTarget: source.primaryTarget ?? DEFAULT_TARGET[source.resultado],
    secondary,
    secondaryTarget: source.secondaryTarget ?? DEFAULT_TARGET[secondary],
    fronts,
    products: Object.fromEntries(source.products.map((product) => [product.produto_nome, product.papel])),
    duplicatedFrom: source.name,
    duplicatedFromId: source.id,
  }
}
