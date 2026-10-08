// The calendar every test follows (Testes 2.0, playbook): what to check on each day, so nobody
// decides on day 3 or forgets to look at the draw.

export const PLAYBOOK = [
  { from: 0, label: 'D0 · Subir', text: 'Cole o link da Central nos anúncios e confira com o verificador de link.' },
  { from: 1, label: 'D1 · Primeiros cliques', text: 'Confira se os cliques chegam nas variantes e se a primeira venda chega com código.' },
  { from: 3, label: 'D3 · Conferir o sorteio', text: 'O selo "sorteio no peso" deve estar ok. Se não estiver, o link de algum anúncio está errado.' },
  { from: 7, label: 'D7 · Primeira leitura', text: 'Olhe a tendência, mas não decida: uma semana ainda é pouco para a maioria dos testes.' },
  { from: 10, label: 'D10–21 · Decidir', text: 'Decida quando o card for para "Pede decisão": amostra batida e regra do jogo atingida.' },
] as const

/** What not to do while a test runs: each one mixes the result or makes it lie. */
export const PLAYBOOK_DONTS = [
  'editar o anúncio no meio do teste',
  'mudar o peso das variantes',
  'pausar uma variante "que está perdendo"',
  'decidir antes de 7 dias',
  'rodar outro teste na mesma camada',
] as const

/** The step of the calendar the test is in, by days running (day 0 is the day it went live). */
export function playbookStep(daysRunning: number): number {
  let current = 0
  PLAYBOOK.forEach((step, index) => {
    if (daysRunning >= step.from) current = index
  })
  return current
}
