import { describe, it, expect } from 'vitest'
import {
  MODELS,
  applyModel,
  coherence,
  duplicateProject,
  emptyProject,
  blocksDraft,
  isBlocked,
  needsProducts,
  pageConflict,
  previewFront,
  projectTag,
  rename,
  seals,
  slugify,
  type SealContext,
  type WizardProject,
} from './project-wizard'

const context: SealContext = { campaigns: [], existingPages: [], activePages: 0, takenSlugs: [] }
const named = (name: string) => rename(emptyProject(), name)

describe('slug and tag', () => {
  it('derives the address and the short tag from the name', () => {
    expect(slugify('1K LATAM')).toBe('1k-latam')
    expect(slugify('Reabertura Ação T15!')).toBe('reabertura-acao-t15')
    expect(projectTag('1K LATAM')).toBe('1KL')
    expect(projectTag('Reabertura T15')).toBe('RET')
    expect(projectTag('Perpétuo')).toBe('PERP')
    expect(projectTag('')).toBe('PRJ')
  })

  it('carries a rename to the slug and to the tags not typed by hand', () => {
    const project = named('1K LATAM')
    expect(project.slug).toBe('1k-latam')
    expect(project.fronts.map((front) => front.tag)).toEqual(['[1KL][CAP]', '[1KL][VND]'])
    const edited = { ...project, slugEdited: true, fronts: [{ ...project.fronts[0], tag: '[X]', tagEdited: true }, project.fronts[1]] }
    const renamed = rename(edited, 'Turma 16')
    expect(renamed.slug).toBe('1k-latam')
    expect(renamed.fronts.map((front) => front.tag)).toEqual(['[X]', '[TU1][VND]'])
  })
})

describe('models', () => {
  it('pre-fills metrics, targets and fronts with page slots', () => {
    for (const [model, preset] of Object.entries(MODELS)) {
      const project = applyModel(named('Teste'), model as keyof typeof MODELS)
      expect(project.primary).toBe(preset.primary)
      expect(project.secondary).not.toBe(project.primary)
      expect(project.primaryTarget).toBeGreaterThan(0)
      expect(project.fronts).toHaveLength(preset.fronts.length)
    }
    const paid = applyModel(named('Teste'), 'pago')
    expect(paid.fronts[0].pages.map((page) => page.kind)).toEqual(['captura', 'obrigado'])
    expect(needsProducts(paid)).toBe(true)
    expect(needsProducts(applyModel(named('Teste'), 'captacao'))).toBe(false)
  })
})

describe('coherence', () => {
  it('projects the CPA a CPL delivers at a conversion and tells what closes the gap', () => {
    const project: WizardProject = { ...named('X'), primary: 'compra', primaryTarget: 120, secondary: 'lead', secondaryTarget: 4 }
    expect(coherence(project, 3.5, 0)).toMatchObject({ kind: 'cpl_cpa', ok: true })
    const tight = coherence({ ...project, primaryTarget: 100 }, 3, 0)
    expect(tight).toMatchObject({ kind: 'cpl_cpa', ok: false })
    if (tight?.kind !== 'cpl_cpa') throw new Error('expected cpl_cpa')
    expect(tight.projectedCpa).toBeCloseTo(133.33, 1)
    expect(tight.neededCpl).toBeCloseTo(3)
    expect(tight.neededConversionPct).toBeCloseTo(4)
  })

  it('bounds the CPA by ticket ÷ ROAS', () => {
    const project: WizardProject = { ...named('X'), primary: 'roas', primaryTarget: 2.5, secondary: 'compra', secondaryTarget: 250 }
    expect(coherence(project, 0, 497)).toMatchObject({ kind: 'roas_cpa', ok: false, maxCpa: 198.8 })
    expect(coherence({ ...project, secondaryTarget: 150 }, 0, 497)).toMatchObject({ ok: true })
    expect(coherence({ ...project, secondary: 'alcance' }, 0, 497)).toBeNull()
  })
})

describe('seals', () => {
  it('blocks a project with no name, no front or no entry product when a metric needs sales', () => {
    const project = { ...emptyProject(), fronts: [] }
    const texts = seals(project, context).filter((seal) => seal.tone === 'crit').map((seal) => seal.text)
    expect(texts).toEqual(expect.arrayContaining(['Projeto sem nome.', 'Projeto sem frente: não há de onde vir o gasto.', 'Uma métrica escolhida depende de venda (CPA ou ROAS) e não há produto de entrada.']))
    // A draft can wait for fronts and products; a project without a name cannot be saved at all.
    expect(blocksDraft(seals({ ...named('1K LATAM'), fronts: [] }, context))).toBe(false)
    expect(blocksDraft(seals(project, context))).toBe(true)
    const ready = { ...named('1K LATAM'), products: { '1K Por Dia': 'entrada' as const } }
    expect(isBlocked(seals(ready, context))).toBe(false)
  })

  it('flags a campaign two fronts take, a campaign of another project and a taken address', () => {
    const project = { ...named('1K LATAM'), products: { P: 'entrada' as const } }
    const campaigns = [
      { campaign_name: '[1KL][CAP] Frio', spend: 100, owner_project: null },
      { campaign_name: '[1KL][VND][1KL][CAP] Misto', spend: 50, owner_project: null },
      { campaign_name: '[1KL][VND] Antiga', spend: 70, owner_project: 'Turma 15' },
    ]
    expect(previewFront(project, project.fronts[0], campaigns)).toMatchObject({ spend: 150 })
    const list = seals(project, { ...context, campaigns, takenSlugs: ['1k-latam'] })
    expect(list.map((seal) => [seal.tone, seal.text])).toEqual(
      expect.arrayContaining([
        ['crit', 'Frente Captação: 1 campanha(s) em duas frentes.'],
        ['crit', 'Já existe um projeto com o endereço /1k-latam.'],
        ['warn', 'Frente Captação recebe anúncio e não tem página vigiada.'],
      ])
    )
  })

  it('requires a source and its own date window for a mirror front, whatever the project dates', () => {
    const base = { ...named('1K LATAM'), products: { P: 'entrada' as const }, startsOn: '2026-10-01', endsOn: '2026-10-31' }
    const mirror = { ...base.fronts[0], kind: 'espelho' as const }
    const texts = (front: typeof mirror) => seals({ ...base, fronts: [front] }, context).map((seal) => seal.text)
    expect(texts(mirror)).toContain('Frente espelho Captação sem projeto de origem.')
    expect(texts(mirror)).toContain('Frente espelho Captação sem janela de datas.')
    expect(texts({ ...mirror, windowStart: '2026-10-10', windowEnd: '2026-10-05' })).toContain('Frente espelho Captação: o fim da janela vem antes do início.')
    const ok = texts({ ...mirror, sourceProjectId: 'p1', windowStart: '2026-10-05', windowEnd: '2026-10-10' })
    expect(ok.filter((text) => text.startsWith('Frente espelho'))).toEqual([])
  })

  it('finds a page already in another front, here or in another project', () => {
    const base = named('1K LATAM')
    const project = {
      ...base,
      fronts: [
        { ...base.fronts[0], pages: [{ kind: 'captura' as const, url: 'https://site.com/captura/' }] },
        { ...base.fronts[1], pages: [{ kind: 'vendas' as const, url: 'https://site.com/captura?utm=1' }, { kind: 'vendas' as const, url: 'https://site.com/old' }] },
      ],
    }
    const existing = [{ url: 'https://site.com/old', where: 'Turma 15 · Vendas' }]
    expect(pageConflict(project, 0, 0, existing)).toBe('Frente Vendas')
    expect(pageConflict(project, 1, 1, existing)).toBe('Turma 15 · Vendas')
  })
})

describe('duplicate', () => {
  it('copies fronts with the tag swapped, metrics, products and pages to review', () => {
    const project = duplicateProject(rename(emptyProject(), 'Turma 16'), {
      id: 'p1',
      name: 'Turma 15',
      modelo: 'pago',
      resultado: 'compra',
      metricaSecundaria: 'lead',
      primaryTarget: 150,
      secondaryTarget: 5,
      fronts: [
        { code: 'CAP', name: 'Captação', sourceProjectId: null, includes: ['[TU1][CAP]'], primary: 'lead', primaryTarget: 4, secondary: 'alcance', secondaryTarget: 20, pages: [{ url: 'https://s.com/t15', tipo: 'captura' }] },
        { code: 'VND', name: 'Vendas', sourceProjectId: null, includes: ['[t15] vendas'], primary: null, primaryTarget: null, secondary: null, secondaryTarget: null, pages: [{ url: 'https://s.com/v', tipo: null }] },
        { code: 'ESP', name: 'Espelho', sourceProjectId: 'p0', includes: [], primary: null, primaryTarget: null, secondary: null, secondaryTarget: null, pages: [] },
      ],
      products: [{ produto_nome: 'Curso', papel: 'entrada' }],
    })
    expect(project.primaryTarget).toBe(150)
    expect(project.fronts[0]).toMatchObject({ tag: '[TU1][CAP]', own: true, primary: 'lead', primaryTarget: 4 })
    expect(project.fronts[0].pages[0]).toMatchObject({ kind: 'captura', review: true })
    expect(project.fronts[1]).toMatchObject({ tag: '[t15] vendas', tagEdited: true, own: false })
    // The kind comes from the page's column; a page without one is a sales page.
    expect(project.fronts[1].pages[0]).toMatchObject({ kind: 'vendas' })
    // The old project's window is not the new one's.
    expect(project.fronts[2]).toMatchObject({ kind: 'espelho', sourceProjectId: 'p0', windowStart: '', windowEnd: '' })
    expect(project.products).toEqual({ Curso: 'entrada' })
    expect(project.duplicatedFrom).toBe('Turma 15')
  })
})
