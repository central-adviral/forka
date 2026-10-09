import { describe, it, expect } from 'vitest'
import { buildNav, navHeading, projectSwitchHref, resolveActive, type BuildNavInput } from './nav-config'
import { ANALYSIS_TABS } from '@/lib/domain/analysis-tabs'

const slug = 'voe'
const base = '/dashboard/clients/voe'

function nav(overrides: Partial<BuildNavInput> = {}) {
  return buildNav({ clientSlug: slug, role: 'owner', project: '1k', search: '', active: null, counts: {}, ...overrides })
}
const sectionIds = (groups: ReturnType<typeof buildNav>) => groups.flatMap((group) => group.sections.map((section) => section.id))
const subIds = (groups: ReturnType<typeof buildNav>, section: string) =>
  groups.flatMap((group) => group.sections).find((item) => item.id === section)?.subs.map((sub) => sub.id) ?? []

describe('resolveActive: the active section and subsection come from the URL only', () => {
  it('reads the path, the aba query and the anchor', () => {
    expect(resolveActive(base, '', '', slug)).toEqual({ section: 'hoje', sub: 'fila' })
    expect(resolveActive(base, '', '#ritmo', slug)).toEqual({ section: 'hoje', sub: 'ritmo' })
    expect(resolveActive(`${base}/painel`, '', '', slug)).toEqual({ section: 'alertas', sub: 'abertos' })
    expect(resolveActive(`${base}/painel`, '', '#vigias', slug)).toEqual({ section: 'alertas', sub: 'vigias' })
    expect(resolveActive(`${base}/paginas`, '', '', slug)).toEqual({ section: 'alertas', sub: 'paginas' })
    expect(resolveActive(`${base}/funis-venda/1k`, '', '', slug)).toEqual({ section: 'desempenho', sub: 'visao' })
    expect(resolveActive(`${base}/funis-venda/1k`, 'periodo=30d&aba=criativos', '', slug)).toEqual({ section: 'desempenho', sub: 'criativos' })
    expect(resolveActive(`${base}/funis-venda/1k`, 'aba=nada', '', slug)).toEqual({ section: 'desempenho', sub: 'visao' })
    expect(resolveActive(`${base}/backlog`, 'projeto=1k', '', slug)).toEqual({ section: 'testes', sub: 'quadro' })
    expect(resolveActive(`${base}/backlog`, 'projeto=1k&aba=regras', '', slug)).toEqual({ section: 'testes', sub: 'regras-jogo' })
    expect(resolveActive(`${base}/tests`, '', '', slug)).toEqual({ section: 'testes', sub: 'ab' })
    expect(resolveActive(`${base}/funis-venda/1k/configurar`, '', '', slug)).toEqual({ section: 'projeto', sub: 'visao-projeto' })
    expect(resolveActive(`${base}/funis-venda/1k/produtos`, '', '', slug)).toEqual({ section: 'projeto', sub: 'produtos' })
    expect(resolveActive(`${base}/funis-venda/1k/regras`, '', '', slug)).toEqual({ section: 'projeto', sub: 'regras-campanha' })
    expect(resolveActive(`${base}/funis-venda/1k/metas`, '', '', slug)).toEqual({ section: 'projeto', sub: 'metas' })
    expect(resolveActive(`${base}/funis-venda/1k/plano`, '', '', slug)).toEqual({ section: 'projeto', sub: 'metas' })
    expect(resolveActive(`${base}/metas`, '', '', slug)).toEqual({ section: 'projeto', sub: 'metas' })
    expect(resolveActive(`${base}/integrations`, '', '', slug)).toEqual({ section: 'cliente', sub: 'integracoes' })
    expect(resolveActive(`${base}/membros`, '', '', slug)).toEqual({ section: 'cliente', sub: 'membros' })
  })

  it('keeps the section but no subsection on pages that are none of them, and nothing off the client', () => {
    expect(resolveActive(`${base}/tests/oferta`, '', '', slug)).toEqual({ section: 'testes', sub: null })
    expect(resolveActive(`${base}/funis-venda`, '', '', slug)).toEqual({ section: 'desempenho', sub: null })
    expect(resolveActive(`${base}/funis-venda/new`, '', '', slug)).toEqual({ section: 'projeto', sub: null })
    expect(navHeading(resolveActive(`${base}/funis-venda/new`, '', '', slug))).toMatchObject({ group: 'Configurar', section: 'Funil', sub: null })
    expect(resolveActive('/dashboard', '', '', slug)).toBeNull()
    expect(resolveActive('/dashboard/clients/outro', '', '', slug)).toBeNull()
  })

  it('marks exactly the matching section and subsection active in the built menu', () => {
    const groups = nav({ active: resolveActive(`${base}/painel`, '', '#vigias', slug) })
    const sections = groups.flatMap((group) => group.sections)
    expect(sections.filter((section) => section.active).map((section) => section.id)).toEqual(['alertas'])
    expect(sections.flatMap((section) => section.subs).filter((sub) => sub.active).map((sub) => sub.id)).toEqual(['vigias'])
    expect(navHeading(resolveActive(`${base}/painel`, '', '#vigias', slug))).toMatchObject({ group: 'Operar', section: 'Alertas', sub: 'Vigias' })
  })
})

describe('buildNav: what each role sees', () => {
  it('hides the whole Configurar group from the client role, which is also what "Ver como cliente" uses', () => {
    const groups = nav({ role: 'cliente' })
    expect(groups.map((group) => group.id)).toEqual(['operar', 'analisar', 'testar'])
    expect(sectionIds(groups)).not.toContain('projeto')
    expect(sectionIds(groups)).not.toContain('cliente')
  })

  it('gives the owner every built screen, and keeps owner-only and editor-only ones from the roles below', () => {
    expect(sectionIds(nav())).toEqual(['hoje', 'alertas', 'desempenho', 'testes', 'projeto', 'cliente'])
    // The Meta tax lives inside Integrações; it is not a subsection of its own.
    expect(subIds(nav(), 'cliente')).toEqual(['integracoes', 'membros'])
    // Integrações and Membros answer 404 below owner, so the section has nothing left for an analista.
    expect(sectionIds(nav({ role: 'analista' }))).not.toContain('cliente')
    expect(subIds(nav({ role: 'analista' }), 'testes')).toEqual(['quadro', 'ab', 'aprendizados'])
    expect(subIds(nav({ role: 'gestor' }), 'testes')).toEqual(['quadro', 'ab', 'aprendizados', 'regras-jogo'])
  })

  it('names the stage screens the same in Configurar, Desempenho and the analysis tabs', () => {
    const subs = nav().flatMap((group) => group.sections).flatMap((section) => section.subs)
    expect(subs.find((sub) => sub.id === 'regras-campanha')).toMatchObject({ label: 'Etapas e frentes', desc: 'Jornada, etiquetas, metas e páginas' })
    expect(subs.find((sub) => sub.id === 'frentes')?.label).toBe('Etapas e frentes')
    expect(ANALYSIS_TABS.find((tab) => tab.value === 'frentes')?.label).toBe('Etapas e frentes')
  })

  it('lists the funnel setup in the checklist order', () => {
    expect(subIds(nav(), 'projeto')).toEqual(['visao-projeto', 'regras-campanha', 'produtos', 'metas'])
  })

  it('never shows the subsections that do not exist yet', () => {
    const all = nav().flatMap((group) => group.sections).flatMap((section) => section.subs.map((sub) => sub.label))
    expect(all).not.toContain('Resumo para o cliente')
    expect(subIds(nav(), 'hoje')).toEqual(['fila', 'ritmo'])
  })

  it('leaves out what needs a project when the client has none', () => {
    const groups = nav({ project: null })
    expect(sectionIds(groups)).not.toContain('desempenho')
    expect(subIds(groups, 'testes')).toEqual(['ab', 'aprendizados'])
    expect(subIds(groups, 'projeto')).toEqual([])
  })
})

describe('buildNav: links, badges and setup dots', () => {
  it('points every subsection at its existing route', () => {
    const groups = nav()
    const href = (section: string, sub: string) => groups.flatMap((g) => g.sections).find((s) => s.id === section)!.subs.find((s) => s.id === sub)!.href
    expect(href('hoje', 'ritmo')).toBe(`${base}#ritmo`)
    expect(href('alertas', 'abertos')).toBe(`${base}/painel#atencao`)
    expect(href('desempenho', 'visao')).toBe(`${base}/funis-venda/1k`)
    expect(href('desempenho', 'origem')).toBe(`${base}/funis-venda/1k?aba=origem`)
    expect(href('testes', 'quadro')).toBe(`${base}/backlog?projeto=1k`)
    expect(href('testes', 'regras-jogo')).toBe(`${base}/backlog?projeto=1k&aba=regras`)
    expect(href('projeto', 'visao-projeto')).toBe(`${base}/funis-venda/1k/configurar`)
    expect(href('projeto', 'metas')).toBe(`${base}/funis-venda/1k/metas`)
    expect(href('cliente', 'integracoes')).toBe(`${base}/integrations`)
  })

  it('keeps the period and the front when switching analysis tabs on the analysis page', () => {
    const groups = nav({ search: 'periodo=30d&frente=f1&aba=trafego', active: { section: 'desempenho', sub: 'trafego' } })
    const tabs = groups.flatMap((g) => g.sections).find((s) => s.id === 'desempenho')!.subs
    expect(tabs.find((t) => t.id === 'criativos')!.href).toBe(`${base}/funis-venda/1k?periodo=30d&frente=f1&aba=criativos`)
    expect(tabs.find((t) => t.id === 'visao')!.href).toBe(`${base}/funis-venda/1k?periodo=30d&frente=f1`)
  })

  it('words the badges for screen readers, not only with color', () => {
    const groups = nav({
      counts: {
        queue: { count: 3, crit: 1, warn: 2 },
        openAlerts: { count: 2, crit: 0 },
        testsRunning: 4,
        setup: { done: 4, total: 5, nextLabel: 'Produtos', stepDone: { integracoes: true, etapas: true, produtos: false, metas: true, conferir: false } },
      },
    })
    const badge = (id: string) => groups.flatMap((g) => g.sections).find((s) => s.id === id)!.badge
    expect(badge('hoje')).toEqual({ text: '3', tone: 'crit', label: '3 itens na fila, 1 crítico' })
    expect(badge('alertas')).toEqual({ text: '2', tone: 'warn', label: '2 alertas abertos' })
    expect(badge('testes')).toEqual({ text: '4', tone: 'info', label: '4 testes rodando' })
    expect(badge('projeto')).toEqual({ text: '4/5', tone: 'warn', label: '4 de 5 passos configurados' })
    const projectSubs = groups.flatMap((g) => g.sections).find((s) => s.id === 'projeto')!.subs
    expect(projectSubs.map((sub) => [sub.id, sub.status])).toEqual([
      ['visao-projeto', 'warn'],
      ['regras-campanha', 'ok'],
      ['produtos', 'warn'],
      ['metas', 'ok'],
    ])
  })

  it('shows no badge while the counts have not arrived or are zero', () => {
    expect(nav().flatMap((g) => g.sections).every((s) => s.badge === null)).toBe(true)
    expect(nav({ counts: { queue: { count: 0, crit: 0, warn: 0 } } }).flatMap((g) => g.sections).find((s) => s.id === 'hoje')!.badge).toBeNull()
  })
})

describe('projectSwitchHref', () => {
  it('keeps the same place for the other project when the page is about a project', () => {
    expect(projectSwitchHref(base, 'capt', `${base}/funis-venda/1k`, 'aba=criativos', { section: 'desempenho', sub: 'criativos' })).toBe(
      `${base}/funis-venda/capt?aba=criativos`
    )
    expect(projectSwitchHref(base, 'capt', `${base}/funis-venda/1k/produtos`, '', { section: 'projeto', sub: 'produtos' })).toBe(`${base}/funis-venda/capt/produtos`)
    expect(projectSwitchHref(base, 'capt', `${base}/backlog`, 'projeto=1k&aba=regras', { section: 'testes', sub: 'regras-jogo' })).toBe(
      `${base}/backlog?projeto=capt&aba=regras`
    )
  })

  it("opens the project's analysis from anywhere else", () => {
    expect(projectSwitchHref(base, 'capt', `${base}/painel`, '', { section: 'alertas', sub: 'abertos' })).toBe(`${base}/funis-venda/capt`)
    expect(projectSwitchHref(base, 'capt', `${base}/funis-venda/1k/edit`, '', { section: 'projeto', sub: null })).toBe(`${base}/funis-venda/capt`)
  })
})
