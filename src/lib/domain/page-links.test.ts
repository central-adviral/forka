import { describe, it, expect } from 'vitest'
import { linkLabel, linkOptionGroups, linkValue, pagesToLinkToFront, parseLinkValue, type LinkProject } from './page-links'

const projects: LinkProject[] = [
  {
    id: 'p1',
    name: '1K',
    archived: false,
    fronts: [
      { id: 'f1', name: 'Frio', archived: false },
      { id: 'f2', name: 'Velha', archived: true },
    ],
  },
  { id: 'p2', name: 'Antigo', archived: true, fronts: [{ id: 'f3', name: 'Quente', archived: false }] },
]

describe('linkValue / parseLinkValue', () => {
  it('round-trips project, project + front and no project', () => {
    for (const link of [
      { salesFunnelId: 'p1', frontId: 'f1' },
      { salesFunnelId: 'p1', frontId: null },
      { salesFunnelId: null, frontId: null },
    ]) {
      expect(parseLinkValue(linkValue(link))).toEqual(link)
    }
  })

  it('never yields a front without its project', () => {
    expect(linkValue({ salesFunnelId: null, frontId: 'f1' })).toBe('|')
    expect(parseLinkValue('|f1')).toEqual({ salesFunnelId: null, frontId: null })
  })
})

describe('linkOptionGroups', () => {
  it('groups live fronts under their live project, project-only option first', () => {
    expect(linkOptionGroups(projects)).toEqual([
      {
        label: '1K',
        options: [
          { value: 'p1|', label: '1K (sem frente)' },
          { value: 'p1|f1', label: '1K › Frio' },
        ],
      },
    ])
  })
})

describe('linkLabel', () => {
  it('names where a page is, archived places included', () => {
    expect(linkLabel(projects, { salesFunnelId: 'p1', frontId: 'f2' })).toBe('1K › Velha')
    expect(linkLabel(projects, { salesFunnelId: 'p2', frontId: null })).toBe('Antigo (sem frente)')
    expect(linkLabel(projects, { salesFunnelId: null, frontId: null })).toBe('Sem funil')
  })
})

describe('pagesToLinkToFront', () => {
  it('offers pages in no front first, then pages of other fronts with where they are now', () => {
    const pages = [
      { id: 'a', label: 'Vendas', salesFunnelId: null, frontId: null },
      { id: 'b', label: 'Obrigado', salesFunnelId: 'p1', frontId: null },
      { id: 'c', label: 'Captura', salesFunnelId: 'p1', frontId: 'f2' },
      { id: 'd', label: 'Já aqui', salesFunnelId: 'p1', frontId: 'f1' },
    ]
    expect(pagesToLinkToFront(pages, 'f1', projects)).toEqual([
      {
        label: 'Sem frente',
        options: [
          { value: 'a', label: 'Vendas · Sem funil' },
          { value: 'b', label: 'Obrigado · 1K (sem frente)' },
        ],
      },
      { label: 'Em outra frente (muda de frente)', options: [{ value: 'c', label: 'Captura · hoje em 1K › Velha' }] },
    ])
  })

  it('drops empty groups', () => {
    expect(pagesToLinkToFront([{ id: 'd', label: 'Já aqui', salesFunnelId: 'p1', frontId: 'f1' }], 'f1', projects)).toEqual([])
  })
})
