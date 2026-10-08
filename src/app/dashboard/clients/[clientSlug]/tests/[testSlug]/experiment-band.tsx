import Link from 'next/link'
import type { LinkVerdict } from '@/lib/domain/experiment-decision'
import type { TimelineEvent } from '@/lib/domain/experiment-timeline'

// The top of the experiment page: the verdict where the evidence is, with the way to act on it,
// and the history that explains every number below.

const mono = 'font-[family-name:var(--font-geist-mono)]'

export interface BandCard {
  code: string
  title: string
  status: string
  learning: string | null
  winnerKey: string | null
  href: string
}

function when(at: string): string {
  return new Date(at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}

export function ExperimentBand({
  card,
  verdict,
  measuring,
  boardHref,
  timeline,
}: {
  card: BandCard | null
  verdict: LinkVerdict | null
  /** One line on why there is no verdict yet, from the report's trust seal. */
  measuring: string
  boardHref: string
  timeline: TimelineEvent[]
}) {
  return (
    <div className="mx-6 mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div
        className={`flex flex-col gap-2 rounded-2xl border px-5 py-4 ${
          verdict ? 'border-[var(--ct-ok)]/40 bg-[var(--ct-ok-soft)]' : 'border-[var(--ct-line)] bg-[var(--ct-surface)]'
        }`}
      >
        <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>
          {card ? `${card.code} · ${card.title}` : 'Link A/B sem teste no Quadro'}
        </span>
        {card?.status === 'decided' ? (
          <>
            <b className="text-[17px]">{card.winnerKey ? `Decidido: venceu ${card.winnerKey}` : 'Decidido sem vencedora'}</b>
            {card.learning && <p className="text-[13px] text-[var(--ct-text-2)]">Aprendizado: {card.learning}</p>}
          </>
        ) : verdict ? (
          <>
            <b className="text-[19px]">
              {verdict.winnerName} vence: {verdict.liftPct >= 0 ? '+' : ''}
              {verdict.liftPct}% de conversão
            </b>
            <span className="text-[12.5px] text-[var(--ct-text-2)]">{verdict.chancePct}% de chance de bater o controle, pelos critérios de decisão do funil.</span>
            <ul className="grid gap-1 text-[12.5px] sm:grid-cols-2">
              {verdict.checks.map((check) => (
                <li key={check.label} className="flex items-baseline gap-2">
                  <span className={check.ok ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-warn)]'}>{check.ok ? '✓' : '!'}</span>
                  <span>{check.label}</span>
                  <span className={`${mono} ml-auto truncate text-[11px] text-[var(--ct-text-3)]`}>{check.value}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <b className="text-[17px]">{card ? 'Ainda medindo' : 'Sem decisão por aqui'}</b>
            <span className="text-[12.5px] text-[var(--ct-text-2)]">
              {card ? measuring : 'A decisão (vencedora, aprendizado e tráfego) acontece num teste do Quadro. Crie um teste de link A/B e vincule este link a ele.'}
            </span>
          </>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          {card && card.status === 'running' && (
            <Link href={`${card.href}#decidir`} className="rounded-full bg-[var(--ct-accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)]">
              {verdict ? 'Declarar vencedora' : 'Decidir mesmo assim'}
            </Link>
          )}
          <Link href={card?.href ?? boardHref} className="rounded-full border border-[var(--ct-line-2)] px-3.5 py-1.5 text-[12.5px] text-[var(--ct-text-2)]">
            {card ? 'Abrir o teste' : 'Ir para o Quadro'}
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
        <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>Histórico</span>
        <ol className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto text-[12.5px]">
          {timeline.map((event, index) => (
            <li key={`${event.at}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
              <span className={`${mono} text-[11px] text-[var(--ct-text-3)]`}>{when(event.at)}</span>
              <span className="text-[var(--ct-text-2)]">{event.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
