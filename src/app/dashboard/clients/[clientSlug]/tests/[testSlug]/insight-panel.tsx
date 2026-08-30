'use client'

import { useState, useTransition } from 'react'
import { generateInsight } from './actions'

export function InsightPanel({ testId, sinceIso }: { testId: string; sinceIso: string | null }) {
  const [insight, setInsight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleGenerate() {
    setError(null)
    startTransition(async () => {
      try {
        const text = await generateInsight({ test_id: testId, since_iso: sinceIso })
        setInsight(text)
      } catch {
        setError('Não foi possível gerar o insight agora. Tente novamente em instantes.')
      }
    })
  }

  return (
    <div className="mx-6 mb-6">
      <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Insight com IA</h2>
      <div className="rounded-[10px] border border-white/[0.08] p-4">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className="h-9 rounded-[9px] bg-[#7C6FF0] px-4 text-[13px] font-medium text-white disabled:opacity-60"
        >
          {isPending ? 'Gerando...' : 'Gerar insight com IA'}
        </button>
        {error && <p className="mt-3 text-sm text-[#F76C6C]">{error}</p>}
        {insight && <p className="mt-3 text-sm leading-relaxed text-[#E8EAF2]">{insight}</p>}
      </div>
    </div>
  )
}
