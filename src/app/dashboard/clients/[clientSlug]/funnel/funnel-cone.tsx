'use client'

import { useState } from 'react'

interface ConeDay {
  data: string
  impressions: number
  clicks: number
  vendas: number
}

export function FunnelCone({ days }: { days: ConeDay[] }) {
  const withImpressions = days.filter((d) => d.impressions > 0)
  const defaultDay = (withImpressions.length > 0 ? withImpressions[withImpressions.length - 1] : days[days.length - 1])?.data ?? ''
  const [selected, setSelected] = useState(defaultDay)
  const day = days.find((d) => d.data === selected) ?? days[days.length - 1]

  if (!day) return null

  const stages = [
    { label: 'Impressões', value: day.impressions, color: '#7C6FF0' },
    { label: 'Cliques', value: day.clicks, color: '#4F8EF7' },
    { label: 'Vendas', value: day.vendas, color: '#2DD4A8' },
  ]
  const maxValue = Math.max(1, stages[0].value)

  return (
    <div className="mb-6 rounded-2xl border border-white/[0.08] p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-['Space_Grotesk'] text-base font-semibold">Funil de Tráfego</h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-[8px] border border-white/[0.08] bg-[#1B2036] px-2.5 py-1.5 text-xs text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
        >
          {days.map((d) => (
            <option key={d.data} value={d.data}>
              {d.data}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col items-center gap-2">
        {stages.map((stage, i) => {
          const widthPct = Math.max(14, (stage.value / maxValue) * 100)
          const prevValue = i > 0 ? stages[i - 1].value : null
          const stepPct = prevValue !== null && prevValue > 0 ? (stage.value / prevValue) * 100 : null
          return (
            <div key={stage.label} className="flex w-full flex-col items-center">
              {stepPct !== null && (
                <span className="mb-1.5 font-['JetBrains_Mono'] text-[11px] text-[#8A90A6]">{stepPct.toFixed(1)}%</span>
              )}
              <div
                className="flex items-center justify-center rounded-[10px] py-3.5 text-center transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: `${stage.color}1A`, border: `1px solid ${stage.color}55` }}
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">{stage.label}</div>
                  <div className="font-['JetBrains_Mono'] text-lg font-semibold" style={{ color: stage.color }}>
                    {stage.value.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
