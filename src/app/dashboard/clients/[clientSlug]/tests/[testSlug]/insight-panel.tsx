'use client'

import { useState, useTransition } from 'react'
import { generateInsight } from './actions'

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 0l1.6 5.4L15 7l-5.4 1.6L8 14l-1.6-5.4L1 7l5.4-1.6L8 0z" fill="currentColor" />
    </svg>
  )
}

export function InsightPanel({
  testId,
  sinceIso,
  untilIso,
}: {
  testId: string
  sinceIso: string | null
  untilIso: string | null
}) {
  const [insight, setInsight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleGenerate() {
    setError(null)
    startTransition(async () => {
      try {
        const text = await generateInsight({ test_id: testId, since_iso: sinceIso, until_iso: untilIso })
        setInsight(text)
      } catch (err) {
        console.error('[insight-generate-failed]', { testId }, err)
        setError('Não foi possível gerar o insight agora. Tente novamente em instantes.')
      }
    })
  }

  return (
    <div className="mx-6 mb-6">
      <div className="mb-2 mt-8 flex items-center gap-2">
        <SparkleIcon className="text-[#8B9BFF]" />
        <h2 className="font-['Space_Grotesk'] text-lg font-semibold">Insight com IA</h2>
      </div>

      <div className="rounded-[12px] border border-[#8B9BFF]/25 bg-gradient-to-br from-[#8B9BFF]/[0.08] to-transparent p-5">
        {isPending ? (
          <div className="flex items-center gap-3 py-1">
            <SparkleIcon className="animate-pulse text-[#8B9BFF]" />
            <p className="text-sm text-[#A1A1AA]">Analisando os dados do teste...</p>
          </div>
        ) : insight ? (
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8B9BFF]/20 text-[#8B9BFF]">
                <SparkleIcon />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-[#8B9BFF]">Insight gerado</span>
            </div>
            <p className="text-sm leading-relaxed text-[#EDEDF0]">{insight}</p>
            <button
              type="button"
              onClick={handleGenerate}
              className="mt-4 text-xs font-medium text-[#A1A1AA] hover:text-[#EDEDF0]"
            >
              Gerar novamente
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#EDEDF0]">Peça pra IA analisar esse teste</p>
              <p className="mt-1 text-xs text-[#A1A1AA]">
                Ela olha visitas, conversões e faturamento de cada variante e recomenda se já dá pra declarar uma
                vencedora.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              className="flex h-10 flex-shrink-0 items-center gap-2 rounded-[9px] bg-[#8B9BFF] px-4 text-[13px] font-medium text-white hover:bg-[#A5B2FF]"
            >
              <SparkleIcon />
              Gerar insight
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[#FF7A73]">{error}</p>}
      </div>
    </div>
  )
}
