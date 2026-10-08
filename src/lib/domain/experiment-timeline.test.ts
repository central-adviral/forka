import { describe, it, expect } from 'vitest'
import { experimentTimeline } from './experiment-timeline'

describe('experimentTimeline', () => {
  it('tells the history in order, with the weight change that resets the draw check', () => {
    const events = experimentTimeline({
      createdAt: '2026-09-25T12:00:00Z',
      firstClickAt: '2026-09-26T09:00:00Z',
      changes: [{ created_at: '2026-09-29T15:00:00Z', field: 'weight_pct', old_value: '70', new_value: '50', variant_name: 'A · Controle' }],
      card: { code: 'T5', startedAt: '2026-09-26T08:00:00Z', decidedAt: '2026-10-07T18:00:00Z', winnerKey: 'B' },
      archivedAt: null,
    })
    expect(events.map((event) => event.text)).toEqual([
      'Teste criado para o card T5.',
      'T5 foi para Rodando: a medição do card conta daqui.',
      'Primeiro clique recebido no link.',
      'Peso de A · Controle: 70% → 50%. O sorteio é conferido a partir daqui.',
      'Decidido: venceu B.',
    ])
  })

  it('works for a test without a card, and marks the archive', () => {
    const events = experimentTimeline({ createdAt: '2026-09-25T12:00:00Z', firstClickAt: null, changes: [], card: null, archivedAt: '2026-10-01T00:00:00Z' })
    expect(events.map((event) => event.text)).toEqual(['Teste criado.', 'Teste arquivado: o link manda todos para o controle.'])
  })
})
