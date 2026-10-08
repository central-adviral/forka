import type { ClientRole } from '@/lib/repo/client-access-repo'
import { readAnalysisTab } from '@/lib/domain/analysis-tabs'
import type { SetupStatus, SetupStepId } from '@/lib/domain/project-setup'

// The Central's navigation in one place: groups, sections, subsections, where each one lives, what
// it is for, and how the current URL maps back to it. The sidebar, the page header, the mobile tabs
// and the ⌘K palette all read from here, so a route renamed once is renamed everywhere.

export type NavTone = 'crit' | 'warn' | 'ok' | 'info'
export type NavIcon = 'hoje' | 'alertas' | 'desempenho' | 'testes' | 'projeto' | 'cliente'
export type NavGroupId = 'operar' | 'analisar' | 'testar' | 'configurar'
export type NavSectionId = 'hoje' | 'alertas' | 'desempenho' | 'testes' | 'projeto' | 'cliente'

/** Cookie with the collapsed-rail preference; read by the layout so the first paint already matches. */
export const NAV_RAIL_COOKIE = 'ct-nav-rail'

const ROLE_RANK: Record<ClientRole, number> = { cliente: 1, analista: 2, gestor: 3, owner: 4 }

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'operar', label: 'Operar' },
  { id: 'analisar', label: 'Analisar' },
  { id: 'testar', label: 'Testar' },
  { id: 'configurar', label: 'Configurar' },
]

/** Everything a link needs to be built. */
export interface NavLinkContext {
  base: string
  /** The project the project-scoped links point at; null when the client has none. */
  project: string | null
  /** The current query string, kept on the analysis tabs so the period and front survive a tab switch. */
  search: string
  /** True when the URL is already on the project's analysis page (the only place the query applies). */
  onAnalysis: boolean
}

interface SubDef {
  id: string
  label: string
  desc: string
  /** Not built yet: listed so the structure matches the design, never shown until the screen exists. */
  exists: boolean
  minRole?: ClientRole
  needsProject?: boolean
  /** The setup step whose state colors this subsection's dot. */
  step?: SetupStepId
  href: (ctx: NavLinkContext) => string
}

interface SectionDef {
  id: NavSectionId
  group: NavGroupId
  label: string
  short: string
  icon: NavIcon
  /** The "what is this for" line under the page title. */
  help: string
  minRole?: ClientRole
  subs: SubDef[]
}

function analysisHref(ctx: NavLinkContext, tab: string): string {
  const query = new URLSearchParams(ctx.onAnalysis ? ctx.search : '')
  if (tab === 'visao') query.delete('aba')
  else query.set('aba', tab)
  const search = query.toString()
  return `${ctx.base}/funis-venda/${ctx.project}${search ? `?${search}` : ''}`
}

export const NAV_SECTIONS: SectionDef[] = [
  {
    id: 'hoje',
    group: 'operar',
    label: 'Hoje',
    short: 'Hoje',
    icon: 'hoje',
    help: 'Abra aqui todo dia. O mais grave vem primeiro e cada item leva direto para onde se resolve.',
    subs: [
      { id: 'fila', label: 'Fila de atenção', desc: 'O que precisa de você agora', exists: true, href: (c) => c.base },
      { id: 'ritmo', label: 'Ritmo do dia', desc: 'Vendas e gasto contra a meta', exists: true, href: (c) => `${c.base}#ritmo` },
      { id: 'resumo', label: 'Resumo para o cliente', desc: 'Texto pronto para o WhatsApp', exists: false, href: (c) => c.base },
    ],
  },
  {
    id: 'alertas',
    group: 'operar',
    label: 'Alertas e páginas',
    short: 'Alertas',
    icon: 'alertas',
    help: 'Os vigias julgam o último dia fechado. A sonda checa se as páginas dos anúncios estão no ar.',
    subs: [
      { id: 'abertos', label: 'Abertos', desc: 'Fora da faixa agora', exists: true, href: (c) => `${c.base}/painel#atencao` },
      { id: 'vigias', label: 'Vigias', desc: 'Métricas observadas', exists: true, href: (c) => `${c.base}/painel#vigias` },
      { id: 'paginas', label: 'Páginas', desc: 'No ar, rápidas e vendendo', exists: true, step: 'paginas', href: (c) => `${c.base}/paginas` },
    ],
  },
  {
    id: 'desempenho',
    group: 'analisar',
    label: 'Desempenho',
    short: 'Análises',
    icon: 'desempenho',
    help: 'Use para entender o porquê de um número: qual frente, qual criativo, qual dia e de onde veio a venda.',
    subs: [
      { id: 'visao', label: 'Visão geral', desc: 'CPA, ROAS, receita e funil', exists: true, needsProject: true, href: (c) => analysisHref(c, 'visao') },
      { id: 'trafego', label: 'Tráfego', desc: 'Mídia dia a dia e padrões', exists: true, needsProject: true, href: (c) => analysisHref(c, 'trafego') },
      { id: 'frentes', label: 'Frentes', desc: 'Gasto e desempenho de cada frente', exists: true, needsProject: true, href: (c) => analysisHref(c, 'frentes') },
      { id: 'criativos', label: 'Criativos', desc: 'Custo e vendas por anúncio', exists: true, needsProject: true, href: (c) => analysisHref(c, 'criativos') },
      { id: 'origem', label: 'Origem das vendas', desc: 'Anúncio, bio, sem UTM', exists: true, needsProject: true, href: (c) => analysisHref(c, 'origem') },
      { id: 'dias', label: 'Dia a dia', desc: 'A tabela completa do período', exists: true, needsProject: true, href: (c) => analysisHref(c, 'dias') },
    ],
  },
  {
    id: 'testes',
    group: 'testar',
    label: 'Testes',
    short: 'Testes',
    icon: 'testes',
    help: 'Cada teste nasce como hipótese, roda medido sozinho e termina com uma decisão e um aprendizado.',
    subs: [
      { id: 'quadro', label: 'Quadro', desc: 'Fila, pronto, rodando, decidido', exists: true, needsProject: true, href: (c) => `${c.base}/backlog?projeto=${c.project}` },
      { id: 'ab', label: 'A/B de link', desc: 'Página contra página', exists: true, href: (c) => `${c.base}/tests` },
      { id: 'aprendizados', label: 'Aprendizados', desc: 'O que testamos e aprendemos', exists: true, href: (c) => `${c.base}/aprendizados` },
      { id: 'regras-jogo', label: 'Regras do jogo', desc: 'Quando cortar e quando vencer', exists: true, needsProject: true, minRole: 'gestor', href: (c) => `${c.base}/backlog?projeto=${c.project}&aba=regras` },
    ],
  },
  {
    id: 'projeto',
    group: 'configurar',
    label: 'Projeto',
    short: 'Projeto',
    icon: 'projeto',
    help: 'Siga a ordem: cada passo usa o anterior. Enquanto faltar um, o topo do menu mostra o que falta.',
    minRole: 'analista',
    subs: [
      { id: 'visao-projeto', label: 'Visão geral', desc: 'O que falta configurar', exists: true, needsProject: true, href: (c) => `${c.base}/funis-venda/${c.project}/configurar` },
      { id: 'produtos', label: 'Produtos', desc: 'Quais vendas contam', exists: true, needsProject: true, step: 'produtos', href: (c) => `${c.base}/funis-venda/${c.project}/produtos` },
      { id: 'regras-campanha', label: 'Regras de campanha', desc: 'Quais campanhas são do projeto', exists: true, needsProject: true, step: 'regras', href: (c) => `${c.base}/funis-venda/${c.project}/regras` },
      { id: 'plano', label: 'Plano', desc: 'Resultado e alvos', exists: true, needsProject: true, step: 'plano', href: (c) => `${c.base}/funis-venda/${c.project}/plano` },
      { id: 'metas', label: 'Metas', desc: 'Vigias além do custo', exists: true, step: 'metas', href: (c) => `${c.base}/metas` },
    ],
  },
  {
    id: 'cliente',
    group: 'configurar',
    label: 'Cliente e equipe',
    short: 'Equipe',
    icon: 'cliente',
    help: 'Vale para todos os projetos do cliente: de onde vêm os dados, o imposto do Meta e quem acessa.',
    minRole: 'analista',
    subs: [
      { id: 'integracoes', label: 'Integrações', desc: 'LaunchOps, Hubla e domínio', exists: true, minRole: 'owner', step: 'integracoes', href: (c) => `${c.base}/integrations` },
      { id: 'membros', label: 'Membros', desc: 'Quem vê e quem edita', exists: true, minRole: 'owner', href: (c) => `${c.base}/membros` },
    ],
  },
]

export interface ActiveNav {
  section: NavSectionId
  /** Null on a page of the section that is none of its subsections (the project list, a test report). */
  sub: string | null
}

/**
 * The section and subsection the URL points at. Derived from the path, the `aba` query and the hash
 * only, so a reload, a shared link or the back button always land on the same highlighted item.
 */
export function resolveActive(pathname: string, search: string, hash: string, clientSlug: string): ActiveNav | null {
  const prefix = `/dashboard/clients/${clientSlug}`
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null
  const rest = pathname.slice(prefix.length).split('/').filter(Boolean)
  const anchor = hash.replace(/^#/, '')
  const aba = new URLSearchParams(search).get('aba')

  if (rest.length === 0) return { section: 'hoje', sub: anchor === 'ritmo' ? 'ritmo' : 'fila' }
  switch (rest[0]) {
    case 'painel':
      return { section: 'alertas', sub: anchor === 'vigias' ? 'vigias' : 'abertos' }
    case 'paginas':
      return { section: 'alertas', sub: rest.length === 1 ? 'paginas' : null }
    case 'backlog':
      return { section: 'testes', sub: aba === 'regras' ? 'regras-jogo' : 'quadro' }
    case 'tests':
      return { section: 'testes', sub: rest.length === 1 ? 'ab' : null }
    case 'aprendizados':
      return { section: 'testes', sub: 'aprendizados' }
    case 'metas':
      return { section: 'projeto', sub: 'metas' }
    case 'integrations':
      return { section: 'cliente', sub: 'integracoes' }
    case 'membros':
      return { section: 'cliente', sub: 'membros' }
    case 'funis-venda': {
      if (rest.length === 1 || rest[1] === 'new') return { section: 'desempenho', sub: null }
      const page = rest[2]
      if (!page) return { section: 'desempenho', sub: readAnalysisTab(aba) }
      if (page === 'configurar') return { section: 'projeto', sub: 'visao-projeto' }
      if (page === 'produtos') return { section: 'projeto', sub: 'produtos' }
      if (page === 'regras') return { section: 'projeto', sub: 'regras-campanha' }
      if (page === 'plano') return { section: 'projeto', sub: 'plano' }
      return { section: 'projeto', sub: null }
    }
    default:
      return null
  }
}

/** The project the URL is about: the analysis/config path, or the backlog's `projeto` query. */
export function projectFromUrl(pathname: string, search: string, clientSlug: string): string | null {
  const match = pathname.match(new RegExp(`^/dashboard/clients/${clientSlug}/funis-venda/([^/]+)`))
  if (match && match[1] !== 'new') return match[1]
  if (pathname.startsWith(`/dashboard/clients/${clientSlug}/backlog`)) return new URLSearchParams(search).get('projeto')
  return null
}

/**
 * Where picking another project in the selector goes: the same place for that project when the
 * current page is about a project (an analysis tab, a config page, the test board), its analysis
 * otherwise.
 */
export function projectSwitchHref(base: string, slug: string, pathname: string, search: string, active: ActiveNav | null): string {
  const analysis = `${base}/funis-venda/${slug}`
  if (!active) return analysis
  if (active.section === 'testes' && (active.sub === 'quadro' || active.sub === 'regras-jogo')) {
    return `${base}/backlog?projeto=${slug}${active.sub === 'regras-jogo' ? '&aba=regras' : ''}`
  }
  const onProject = pathname.match(new RegExp(`^${base}/funis-venda/[^/]+(/[^/]+)?$`))
  if (onProject && pathname !== `${base}/funis-venda/new`) {
    const suffix = onProject[1] ?? ''
    if (suffix === '/edit') return analysis
    return `${analysis}${suffix}${!suffix && search ? `?${search}` : ''}`
  }
  return analysis
}

export interface SetupView {
  done: number
  total: number
  nextLabel: string | null
  stepDone: Partial<Record<SetupStepId, boolean>>
}

export function setupView(status: SetupStatus): SetupView {
  const next = status.steps.find((step) => !step.done)
  return {
    done: status.done,
    total: status.steps.length,
    nextLabel: next?.label ?? null,
    stepDone: Object.fromEntries(status.steps.map((step) => [step.id, step.done])),
  }
}

export interface NavCounts {
  queue?: { count: number; crit: number; warn: number }
  openAlerts?: { count: number; crit: number }
  testsRunning?: number
  abActive?: number
  watchers?: number
  pages?: number
  setup?: SetupView
}

export interface NavBadge {
  text: string
  tone: NavTone
  /** What a screen reader says instead of the color. */
  label: string
}

export interface NavSub {
  id: string
  label: string
  desc: string
  href: string
  active: boolean
  count: number | null
  /** Setup state of the step behind this subsection: done (green) or pending (orange). */
  status: 'ok' | 'warn' | null
}

export interface NavSection {
  id: NavSectionId
  group: NavGroupId
  label: string
  short: string
  icon: NavIcon
  help: string
  href: string
  active: boolean
  badge: NavBadge | null
  subs: NavSub[]
}

export interface NavGroup {
  id: NavGroupId
  label: string
  sections: NavSection[]
}

export interface BuildNavInput {
  clientSlug: string
  /** The role the screens act as: 'cliente' while previewing as the client. */
  role: ClientRole
  project: string | null
  search: string
  active: ActiveNav | null
  counts: NavCounts
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function sectionBadge(id: NavSectionId, counts: NavCounts): NavBadge | null {
  if (id === 'hoje' && counts.queue && counts.queue.count > 0) {
    const { count, crit, warn } = counts.queue
    const tone: NavTone = crit > 0 ? 'crit' : warn > 0 ? 'warn' : 'ok'
    const worst = crit > 0 ? `, ${plural(crit, 'crítico', 'críticos')}` : warn > 0 ? `, ${warn} em atenção` : ''
    return { text: String(count), tone, label: `${plural(count, 'item', 'itens')} na fila${worst}` }
  }
  if (id === 'alertas' && counts.openAlerts && counts.openAlerts.count > 0) {
    const { count, crit } = counts.openAlerts
    return { text: String(count), tone: crit > 0 ? 'crit' : 'warn', label: `${plural(count, 'alerta aberto', 'alertas abertos')}${crit > 0 ? `, ${plural(crit, 'crítico', 'críticos')}` : ''}` }
  }
  if (id === 'testes' && counts.testsRunning) {
    return { text: String(counts.testsRunning), tone: 'info', label: plural(counts.testsRunning, 'teste rodando', 'testes rodando') }
  }
  if (id === 'projeto' && counts.setup) {
    const { done, total } = counts.setup
    return { text: `${done}/${total}`, tone: done === total ? 'ok' : 'warn', label: `${done} de ${total} passos configurados` }
  }
  return null
}

function subCount(id: string, counts: NavCounts): number | null {
  const value =
    id === 'fila' ? counts.queue?.count
    : id === 'abertos' ? counts.openAlerts?.count
    : id === 'vigias' ? counts.watchers
    : id === 'paginas' ? counts.pages
    : id === 'ab' ? counts.abActive
    : undefined
  return value ?? null
}

function subStatus(sub: SubDef, setup: SetupView | undefined): 'ok' | 'warn' | null {
  if (!setup) return null
  if (sub.id === 'visao-projeto') return setup.done === setup.total ? 'ok' : 'warn'
  if (!sub.step) return null
  const done = setup.stepDone[sub.step]
  return done === undefined ? null : done ? 'ok' : 'warn'
}

/** The visible navigation for a role and project: unbuilt, unauthorized and project-less items are left out. */
export function buildNav(input: BuildNavInput): NavGroup[] {
  const rank = ROLE_RANK[input.role]
  const ctx: NavLinkContext = {
    base: `/dashboard/clients/${input.clientSlug}`,
    project: input.project,
    search: input.search,
    onAnalysis: input.active?.section === 'desempenho' && input.active.sub !== null,
  }
  const allowed = (minRole?: ClientRole) => !minRole || rank >= ROLE_RANK[minRole]
  const sections: NavSection[] = []
  for (const def of NAV_SECTIONS) {
    // The client role, and an owner previewing as the client, never see configuration.
    if (def.group === 'configurar' && input.role === 'cliente') continue
    if (!allowed(def.minRole)) continue
    const subs: NavSub[] = def.subs
      .filter((sub) => sub.exists && allowed(sub.minRole) && (!sub.needsProject || input.project !== null))
      .map((sub) => ({
        id: sub.id,
        label: sub.label,
        desc: sub.desc,
        href: sub.href(ctx),
        active: input.active?.section === def.id && input.active.sub === sub.id,
        count: subCount(sub.id, input.counts),
        status: subStatus(sub, input.counts.setup),
      }))
    if (subs.length === 0) continue
    sections.push({
      id: def.id,
      group: def.group,
      label: def.label,
      short: def.short,
      icon: def.icon,
      help: def.help,
      href: subs[0].href,
      active: input.active?.section === def.id,
      badge: sectionBadge(def.id, input.counts),
      subs,
    })
  }
  return NAV_GROUPS.map((group) => ({ ...group, sections: sections.filter((section) => section.group === group.id) })).filter(
    (group) => group.sections.length > 0
  )
}

export interface NavHeading {
  group: string
  section: string
  sub: string | null
  help: string
}

/** What the page header and the breadcrumb say for the active item, or null off the navigation. */
export function navHeading(active: ActiveNav | null): NavHeading | null {
  if (!active) return null
  const def = NAV_SECTIONS.find((item) => item.id === active.section)
  if (!def) return null
  return {
    group: NAV_GROUPS.find((group) => group.id === def.group)!.label,
    section: def.label,
    sub: def.subs.find((sub) => sub.id === active.sub)?.label ?? null,
    help: def.help,
  }
}
