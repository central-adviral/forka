'use client'

import { useState } from 'react'
import { inspectCampaignUrl, type CampaignUrlReport } from '@/lib/domain/campaign-link'

// What breaks in the report when each slot arrives empty. Shown next to the missing chip, because
// "utm_content ausente" means nothing to someone who has not read the migrations.
const CONSEQUENCE: Record<string, string> = {
  utm_source: 'a tabela Por origem não separa este tráfego do orgânico.',
  utm_medium: 'sem o nome da campanha, dois anúncios homônimos em campanhas diferentes viram uma linha só.',
  utm_campaign: 'é a vaga do id do anúncio — sem ela a atribuição volta a depender de adivinhar pelo nome.',
  utm_term: 'o relatório perde o nome do anúncio e mostra "(sem anúncio)".',
  utm_content: 'o nome do conjunto não chega no clique.',
  fb_ad_id: 'dois anúncios com o mesmo nome viram uma linha só e o gasto de um deles some.',
  fb_adset_id: 'o conjunto deixa de ser confirmável pelo id.',
  fb_campaign_id: 'a campanha deixa de ser confirmável pelo id.',
}

export function LinkChecker() {
  const [url, setUrl] = useState('')
  const [report, setReport] = useState<CampaignUrlReport | null>(null)

  function handleCheck() {
    setReport(url.trim() ? inspectCampaignUrl(url.trim()) : null)
  }

  return (
    <div>
      <div className="mb-2.5 font-['JetBrains_Mono'] text-[11px] uppercase tracking-widest text-[#8A90A6]">
        Conferir um link que já está rodando
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCheck()
          }}
          placeholder="Cole aqui a URL do campo Site do anúncio"
          aria-label="URL do anúncio para conferir"
          className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#141829] px-3 py-2.5 font-['JetBrains_Mono'] text-xs text-[#E8EAF2] placeholder:text-[#565F7A] focus:border-[#7C6FF0] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCheck}
          className="flex-shrink-0 rounded-lg border border-white/[0.08] px-4 py-2.5 text-[13px] font-medium text-[#E8EAF2] hover:border-[#7C6FF0]"
        >
          Conferir
        </button>
      </div>

      {report && !report.valid && (
        <p className="mt-3 text-xs text-[#F76C6C]">
          Isso não é uma URL completa. Cole o endereço inteiro, começando com{' '}
          <code className="text-[#F5B94D]">https://</code>.
        </p>
      )}

      {report?.valid && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {report.present.map((key) => (
              <span
                key={key}
                className="rounded-md border border-[#2DD4A8]/30 bg-[#2DD4A8]/[0.09] px-2 py-1 font-['JetBrains_Mono'] text-[11px] text-[#2DD4A8]"
              >
                ✓ {key}
              </span>
            ))}
            {report.missing.map((key) => (
              <span
                key={key}
                className="rounded-md border border-[#F76C6C]/30 bg-[#F76C6C]/[0.09] px-2 py-1 font-['JetBrains_Mono'] text-[11px] text-[#F76C6C]"
              >
                ✕ {key}
              </span>
            ))}
          </div>

          {report.missing.length === 0 ? (
            <p className="mt-3 text-xs text-[#2DD4A8]">Link completo — os 8 parâmetros chegam no clique.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {report.missing.map((key) => (
                <li key={key} className="text-xs text-[#8A90A6]">
                  <span className="font-['JetBrains_Mono'] text-[#F76C6C]">{key}</span> — {CONSEQUENCE[key]}
                </li>
              ))}
            </ul>
          )}

          {!report.carriesAdId && (
            <p className="mt-3 rounded-lg border-l-2 border-[#F5B94D] bg-[#F5B94D]/[0.07] px-3 py-2 text-xs text-[#8A90A6]">
              <strong className="text-[#F5B94D]">Este link não carrega o id do anúncio.</strong> Sem ele a
              atribuição cai de volta na cascata por nome — e nome de anúncio se repete. O id precisa estar em{' '}
              <code className="text-[#F5B94D]">utm_campaign</code> ou em{' '}
              <code className="text-[#F5B94D]">fb_ad_id</code>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
