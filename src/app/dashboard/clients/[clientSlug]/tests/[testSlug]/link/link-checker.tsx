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
      <div className="mb-2.5 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-widest text-[var(--ct-text-2)]">
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
          className="min-w-0 flex-1 rounded-lg border border-[var(--ct-line)] bg-[var(--ct-surface)] px-3 py-2.5 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text)] placeholder:text-[var(--ct-text-3)] focus:border-[var(--ct-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCheck}
          className="flex-shrink-0 rounded-lg border border-[var(--ct-line)] px-4 py-2.5 text-[13px] font-medium text-[var(--ct-text)] hover:border-[var(--ct-accent)]"
        >
          Conferir
        </button>
      </div>

      {report && !report.valid && (
        <p className="mt-3 text-xs text-[var(--ct-crit)]">
          Isso não é uma URL completa. Cole o endereço inteiro, começando com{' '}
          <code className="text-[var(--ct-warn)]">https://</code>.
        </p>
      )}

      {report?.valid && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {report.present.map((key) => (
              <span
                key={key}
                className="rounded-md border border-[var(--ct-ok)]/30 bg-[var(--ct-ok)]/[0.09] px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-ok)]"
              >
                ✓ {key}
              </span>
            ))}
            {report.missing.map((key) => (
              <span
                key={key}
                className="rounded-md border border-[var(--ct-crit)]/30 bg-[var(--ct-crit)]/[0.09] px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-crit)]"
              >
                ✕ {key}
              </span>
            ))}
          </div>

          {report.missing.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--ct-ok)]">Link completo — os 8 parâmetros chegam no clique.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {report.missing.map((key) => (
                <li key={key} className="text-xs text-[var(--ct-text-2)]">
                  <span className="font-[family-name:var(--font-geist-mono)] text-[var(--ct-crit)]">{key}</span> — {CONSEQUENCE[key]}
                </li>
              ))}
            </ul>
          )}

          {!report.carriesAdId && (
            <p className="mt-3 rounded-lg border-l-2 border-[var(--ct-warn)] bg-[var(--ct-warn)]/[0.07] px-3 py-2 text-xs text-[var(--ct-text-2)]">
              <strong className="text-[var(--ct-warn)]">Este link não carrega o id do anúncio.</strong> Sem ele a
              atribuição cai de volta na cascata por nome — e nome de anúncio se repete. O id precisa estar em{' '}
              <code className="text-[var(--ct-warn)]">utm_campaign</code> ou em{' '}
              <code className="text-[var(--ct-warn)]">fb_ad_id</code>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
