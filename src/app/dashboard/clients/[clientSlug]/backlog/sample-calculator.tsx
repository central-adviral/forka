'use client'

import { useState } from 'react'
import { requiredVisitsPerArm } from '@/lib/domain/backlog-readout'
import { MIN_CYCLE_DAYS } from '@/lib/domain/test-trust'

// "Quanto tempo vai levar?": the cost of the test before it goes live, with the same sample rule
// that later decides it (the project's confidence and smallest lift, 80% power, the visitor floor).

const MAX_DAYS = 21
const mono = 'font-[family-name:var(--font-geist-mono)]'
const input = `${mono} w-full rounded-[8px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]`

export function SampleCalculator({ rules, arms }: { rules: { conf: number; mde: number; minVisits: number }; arms: number }) {
  const [ratePct, setRatePct] = useState(2)
  const [mdePct, setMdePct] = useState(rules.mde)
  const [perDay, setPerDay] = useState(1000)
  const sides = Math.max(2, arms)
  const sample = requiredVisitsPerArm(ratePct / 100, rules.conf, mdePct)
  const perArm = sample === null ? null : Math.max(rules.minVisits, sample)
  const days = perArm === null || perDay <= 0 ? null : Math.max(MIN_CYCLE_DAYS, Math.ceil((perArm * sides) / perDay))
  const fits = days !== null && days <= MAX_DAYS

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-[var(--ct-accent)]/40 bg-[var(--ct-surface)] px-4 py-4">
      <b className="text-[14px]">Quanto tempo vai levar?</b>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--ct-text-2)]">
        Conversão atual (%)
        <input type="number" min={0.1} max={90} step={0.1} value={ratePct} onChange={(event) => setRatePct(Number(event.target.value))} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--ct-text-2)]">
        Menor melhora que importa (%)
        <input type="number" min={5} max={200} step={1} value={mdePct} onChange={(event) => setMdePct(Number(event.target.value))} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--ct-text-2)]">
        Pessoas por dia no link
        <input type="number" min={1} step={50} value={perDay} onChange={(event) => setPerDay(Number(event.target.value))} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col rounded-[12px] bg-[var(--ct-surface-2)] px-3 py-2">
          <span className="text-[11px] text-[var(--ct-text-3)]">Pessoas por variante</span>
          <b className={`${mono} text-[20px]`}>{perArm !== null ? perArm.toLocaleString('pt-BR') : '—'}</b>
        </div>
        <div className="flex flex-col rounded-[12px] bg-[var(--ct-surface-2)] px-3 py-2">
          <span className="text-[11px] text-[var(--ct-text-3)]">Duração estimada</span>
          <b className={`${mono} text-[20px]`}>{days !== null ? `${days} dias` : '—'}</b>
        </div>
      </div>
      <p
        className={`rounded-[10px] border-l-[3px] px-3 py-2 text-[12.5px] ${
          days === null ? 'border-[var(--ct-line-2)] text-[var(--ct-text-3)]' : fits ? 'border-[var(--ct-ok)] text-[var(--ct-text-2)]' : 'border-[var(--ct-warn)] text-[var(--ct-text-2)]'
        }`}
      >
        {days === null
          ? 'Informe uma conversão acima de 0 e as pessoas por dia.'
          : fits
            ? `Dentro da janela de ${MIN_CYCLE_DAYS} a ${MAX_DAYS} dias. Dá para rodar.`
            : `Passa de ${MAX_DAYS} dias. Aumente a verba, aceite medir uma melhora maior ou teste uma mudança mais forte.`}
      </p>
      <p className="text-[11.5px] leading-relaxed text-[var(--ct-text-3)]">
        {rules.conf}% de confiança e 80% de poder, a mesma régua que decide o teste ({sides} variantes). O mínimo é {MIN_CYCLE_DAYS} dias, para pegar a
        semana inteira.
      </p>
    </div>
  )
}
