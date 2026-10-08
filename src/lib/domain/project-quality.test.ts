import { describe, it, expect } from 'vitest'
import { cpaSources, qualitySeals, type ProjectQualityRow } from './project-quality'

const clean: ProjectQualityRow = {
  vendas_entrada: 100,
  vendas_anuncio: 80,
  vendas_com_id_anuncio: 70,
  vendas_sem_utm: 12,
  vendas_bio: 5,
  vendas_outra_origem: 3,
  cliente_vendas_sem_projeto: 0,
  cliente_gasto_sem_frente: 0,
  cliente_campanhas_sem_frente: 0,
  cliente_campanhas_em_disputa: 0,
  espelhos_sem_janela: 0,
  vigias_sem_avaliar: 0,
}
const links = { regras: '/r', produtos: '/p', edit: '/e', metas: '/m' }

describe('qualitySeals', () => {
  it('shows nothing when the numbers have nothing left out', () => {
    expect(qualitySeals(clean, links)).toEqual([])
  })

  it('puts a dispute first, as critical, and links each seal to the screen that fixes it', () => {
    const seals = qualitySeals({ ...clean, cliente_campanhas_em_disputa: 1, cliente_gasto_sem_frente: 1234, cliente_campanhas_sem_frente: 3, vigias_sem_avaliar: 2 }, links)
    expect(seals.map((seal) => [seal.label, seal.tone, seal.href])).toEqual([
      ['1 campanha em disputa', 'crit', '/r'],
      ['R$\u00a01.234 sem frente', 'warn', '/r'],
      ['2 vigias que não avaliam', 'warn', '/m'],
    ])
  })
})

describe('cpaSources', () => {
  it('spells out what the CPA counts and what it leaves out', () => {
    expect(cpaSources({ ...clean, cliente_vendas_sem_projeto: 4 })).toEqual([
      { label: 'Vendas de entrada (CPA geral)', value: '100' },
      { label: 'de anúncio pela UTM (CPA de anúncio)', value: '80' },
      { label: 'com o id do anúncio (CPA por frente e Criativos)', value: '70' },
      { label: 'fora do CPA de anúncio', value: '12 sem UTM · 5 da bio · 3 de outra origem' },
      { label: 'do cliente, sem projeto (fora deste CPA)', value: '4' },
    ])
  })
})
