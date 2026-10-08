// The experiment's history, so every alert has its explanation next to it: when it started, when
// the first click came, every weight or URL change (from which the draw is checked again), and when
// the card ran and was decided.

export interface TimelineChange {
  created_at: string
  field: 'weight_pct' | 'destination_url'
  old_value: string | null
  new_value: string | null
  variant_name: string | null
}

export interface TimelineInput {
  createdAt: string
  firstClickAt: string | null
  changes: TimelineChange[]
  card: { code: string; startedAt: string | null; decidedAt: string | null; winnerKey: string | null } | null
  archivedAt: string | null
}

export interface TimelineEvent {
  at: string
  text: string
}

export function experimentTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: input.createdAt, text: input.card ? `Link A/B criado para o teste ${input.card.code}.` : 'Link A/B criado.' }]
  if (input.firstClickAt) events.push({ at: input.firstClickAt, text: 'Primeiro clique recebido no link.' })
  if (input.card?.startedAt) events.push({ at: input.card.startedAt, text: `${input.card.code} foi para Rodando: a medição do teste conta daqui.` })
  for (const change of input.changes) {
    const variant = change.variant_name ?? 'uma variante'
    events.push({
      at: change.created_at,
      text:
        change.field === 'weight_pct'
          ? `Peso de ${variant}: ${change.old_value ?? '?'}% → ${change.new_value ?? '?'}%. O sorteio é conferido a partir daqui.`
          : `Link de ${variant} trocado.`,
    })
  }
  if (input.card?.decidedAt) {
    events.push({ at: input.card.decidedAt, text: input.card.winnerKey ? `Decidido: venceu ${input.card.winnerKey}.` : 'Decidido sem vencedora.' })
  }
  if (input.archivedAt) events.push({ at: input.archivedAt, text: 'Link A/B arquivado: o link manda todos para o controle.' })
  return events.sort((a, b) => a.at.localeCompare(b.at))
}
