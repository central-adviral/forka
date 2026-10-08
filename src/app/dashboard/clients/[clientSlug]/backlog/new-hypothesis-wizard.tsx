'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SampleCalculator } from './sample-calculator'
import { similarLearnings, type Learning } from '@/lib/domain/similar-learnings'

// "Novo experimento" on one page (Testes 2.0): the idea, how it is measured and its variants, with
// the help inside each block and a calculator of what the test costs in people and days.

type Option = { value: string; label: string }

const METHOD_HELP: Record<string, string> = {
  meta: 'As variantes são anúncios no Meta. Cada anúncio leva a tag da variante no nome, e a Central mede gasto, compras (ou leads) e CPA por tag. Use para testar criativo, gancho, copy ou formato.',
  link: 'Um link /r divide o tráfego entre páginas (ou checkouts). A Central conta por pessoa e calcula a chance de cada variante vencer o controle. Use para testar página, oferta ou checkout.',
  antes: 'Muda tudo de uma vez numa data e compara os dias antes e depois. Use só quando não dá para dividir o tráfego: é o método menos confiável, porque o resto também muda com o tempo.',
}

// The numbers each method can decide by: the ones the Central actually measures for it, so the
// metric chosen up front is one the verdict can read.
const METRICS: Record<string, string[]> = {
  link: ['Conversão por pessoa', 'Receita por pessoa (preço e oferta)', 'Taxa de lead por pessoa'],
  meta: ['CPA do anúncio', 'CTR, depois CPA do anúncio', 'CPL do anúncio'],
  antes: ['CPA geral, antes e depois', 'Vendas por dia, antes e depois'],
}

const STAGE_HELP: Record<string, string> = {
  anuncio: 'o que a pessoa vê no feed',
  pagina: 'a página de destino do anúncio',
  checkout: 'o pagamento',
  oferta: 'preço, bônus, garantia',
  formato: 'vídeo, imagem, carrossel',
  obrigado: 'a página depois da compra',
  ativacao: 'o primeiro uso do produto',
  upsell: 'a oferta depois da compra',
}

const SCORES = [
  {
    name: 'impact',
    label: 'Impacto',
    help: 'Quanto o resultado do projeto muda se a hipótese estiver certa. 10 = muda o CPA do projeto inteiro; 1 = mexe num detalhe.',
  },
  {
    name: 'confidence',
    label: 'Confiança',
    help: 'Quanta evidência você já tem de que vai funcionar: dados, um teste parecido que deu certo, pesquisa com cliente. 10 = quase certeza; 1 = palpite.',
  },
  {
    name: 'ease',
    label: 'Facilidade',
    help: 'Quão rápido e barato é colocar no ar. 10 = em uma hora, sem desenvolvedor; 1 = semanas de trabalho.',
  },
] as const

const field =
  'w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] placeholder:text-[var(--ct-text-3)] outline-none focus:border-[var(--ct-accent)]'
const mono = 'font-[family-name:var(--font-geist-mono)]'

function Why({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[14px] bg-[var(--ct-accent-soft)] px-4 py-3">
      <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[var(--ct-surface)] text-[12px] font-semibold text-[var(--ct-accent)]">?</span>
      <div>
        <b className="block text-[13px] font-semibold">{title}</b>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--ct-text-2)]">{children}</p>
      </div>
    </div>
  )
}

export function NewHypothesisWizard({
  action,
  cancelHref,
  nextCode,
  stages,
  methods,
  serverError,
  defaultConversion,
  rules,
  learnings,
}: {
  action: (formData: FormData) => void | Promise<void>
  cancelHref: string
  nextCode: string
  stages: Option[]
  methods: Option[]
  /** The error the server sent back on the last submit; its draft is restored when set. */
  serverError?: string
  /** What counts as a conversion in this project: a Hubla sale, or a lead on the thank-you page. */
  defaultConversion: 'hubla_webhook' | 'thank_you_page'
  /** The project's rules of the game: the calculator sizes the sample the way the verdict will. */
  rules: { conf: number; mde: number; minVisits: number }
  /** The project's decided tests, to point at a learning that may already answer the new idea. */
  learnings: Learning[]
}) {
  const [title, setTitle] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [stage, setStage] = useState('pagina')
  const [method, setMethod] = useState('meta')
  const [scores, setScores] = useState({ impact: 5, confidence: 5, ease: 5 })
  const [metric, setMetric] = useState('')
  const [owner, setOwner] = useState('')
  const [variants, setVariants] = useState('')
  const [createLink, setCreateLink] = useState(true)
  const [testType, setTestType] = useState<'page' | 'checkout'>('page')
  const [salesPageUrl, setSalesPageUrl] = useState('')
  const [conversionMethod, setConversionMethod] = useState(defaultConversion)
  const [urls, setUrls] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(serverError ?? null)

  // A failed submit redirects back with the error and remounts the form: the draft saved on submit
  // brings back what was typed. Any other open starts clean and drops an old draft.
  const draftKey = `ct-hypothesis-draft:${cancelHref}`
  useEffect(() => {
    try {
      const saved = serverError ? sessionStorage.getItem(draftKey) : null
      sessionStorage.removeItem(draftKey)
      if (!saved) return
      const draft = JSON.parse(saved)
      /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage only exists after mount */
      setTitle(draft.title ?? '')
      setHypothesis(draft.hypothesis ?? '')
      setStage(draft.stage ?? 'pagina')
      setMethod(draft.method ?? 'meta')
      setScores(draft.scores ?? { impact: 5, confidence: 5, ease: 5 })
      setMetric(draft.metric ?? '')
      setOwner(draft.owner ?? '')
      setVariants(draft.variants ?? '')
      setCreateLink(draft.createLink ?? true)
      setTestType(draft.testType ?? 'page')
      setSalesPageUrl(draft.salesPageUrl ?? '')
      setConversionMethod(draft.conversionMethod ?? defaultConversion)
      setUrls(draft.urls ?? [])
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // No storage (private window) or a broken draft: start clean.
    }
  }, [draftKey, serverError, defaultConversion])

  const variantNames = variants.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, 26)
  const linkNow = method === 'link' && createLink
  const ice = Math.round(((scores.impact + scores.confidence + scores.ease) / 3) * 10) / 10

  // What keeps the form from submitting; the server checks the same rules again.
  function blocker(at: number): string | null {
    if (at === 0 && !title.trim()) return 'Dê um título para a hipótese.'
    if (at === 4 && variantNames.length < 2) return 'Liste pelo menos duas variantes: o controle e uma desafiante.'
    if (at === 4 && linkNow) {
      if (testType === 'checkout' && !/^https?:\/\//i.test(salesPageUrl)) return 'Informe a URL da página de vendas, com https://.'
      const missing = variantNames.findIndex((_, index) => !/^https?:\/\//i.test(urls[index] ?? ''))
      if (missing >= 0) return `Falta o link da variante ${String.fromCharCode(65 + missing)}, com https://.`
    }
    return null
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const reason = blocker(0) ?? blocker(4)
        if (reason) {
          event.preventDefault()
          setProblem(reason)
          return
        }
        try {
          sessionStorage.setItem(draftKey, JSON.stringify({ title, hypothesis, stage, method, scores, metric, owner, variants, createLink, testType, salesPageUrl, conversionMethod, urls }))
        } catch {
          // Without storage the form still submits; only the restore on error is lost.
        }
      }}
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
    >

      <div className="card-shadow flex min-w-0 flex-col gap-5 rounded-[22px] border border-[var(--ct-line)] px-6 py-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`${mono} text-[11px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>
            Novo experimento
          </span>
          <span className={`${mono} ml-auto rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]`}>{nextCode}</span>
        </div>

        <section className="flex flex-col gap-4 border-b border-[var(--ct-line)] pb-6 last:border-b-0 last:pb-0">
          <h2 className="text-[20px] font-semibold">Qual é a ideia?</h2>
          <Why title="Por que escrever a hipótese">
            Um teste sem hipótese só diz qual versão ganhou, não o porquê. Escrever &quot;se mudarmos X, Y melhora porque Z&quot; obriga a dizer o que você
            espera e por quê; no fim, o aprendizado é a resposta a esse porquê, e é ele que vale para os próximos testes.
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Título curto (aparece no card do quadro)
            <input name="title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ex.: Prova social acima da dobra" className={field} />
          </label>
          {similarLearnings(title, learnings).map((learning) => (
            <p key={learning.code} className="rounded-[10px] border-l-[3px] border-[var(--ct-warn)] bg-[var(--ct-surface-2)] px-3 py-2 text-[12.5px] text-[var(--ct-text-2)]">
              <b className="text-[var(--ct-text)]">Aprendizado parecido: {learning.code} &quot;{learning.title}&quot;</b>
              {learning.result ? ` (${learning.result})` : ''}. {learning.learning}
            </p>
          ))}
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Hipótese
            <textarea
              name="hypothesis"
              rows={3}
              maxLength={1000}
              value={hypothesis}
              onChange={(event) => setHypothesis(event.target.value)}
              placeholder="Se colocarmos prints de lojas na primeira dobra, a conversão da página sobe, porque o visitante vê prova antes de rolar."
              className={field}
            />
          </label>
        </section>

        <section className="flex flex-col gap-4 border-b border-[var(--ct-line)] pb-6 last:border-b-0 last:pb-0">
          <h2 className="text-[20px] font-semibold">Onde e como testar?</h2>
          <Why title="Por que escolher a etapa e o método">
            A etapa diz em que ponto do funil a mudança acontece, e serve para filtrar e comparar testes depois. O método define como a Central mede: o
            método errado mede a coisa errada (um teste de página não aparece no gasto por anúncio, por exemplo).
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Etapa do funil
            <select name="stage" value={stage} onChange={(event) => setStage(event.target.value)} className={field}>
              {stages.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {STAGE_HELP[option.value] ?? ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs text-[var(--ct-text-3)]">Método</legend>
            {methods.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer gap-3 rounded-[14px] border border-[var(--ct-line)] px-4 py-3 has-[:checked]:border-[var(--ct-accent)] has-[:checked]:bg-[var(--ct-accent-soft)]"
              >
                <input type="radio" name="method" value={option.value} checked={method === option.value} onChange={() => setMethod(option.value)} className="mt-1" />
                <span>
                  <b className="block text-[13.5px] font-semibold">{option.label}</b>
                  <span className="block text-[12.5px] leading-relaxed text-[var(--ct-text-2)]">{METHOD_HELP[option.value]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="flex flex-col gap-4 border-b border-[var(--ct-line)] pb-6 last:border-b-0 last:pb-0">
          <h2 className="text-[20px] font-semibold">Qual a prioridade?</h2>
          <Why title="Por que dar notas (ICE)">
            Sempre há mais ideias do que tempo. A média das três notas é o ICE, e a fila do quadro é ordenada por ele: o que tem mais chance de mudar o
            resultado com menos esforço sobe primeiro. Seja honesto nas notas; o ICE só ajuda se as notas forem comparáveis entre testes.
          </Why>
          <div className="grid gap-3 md:grid-cols-3">
            {SCORES.map((score) => (
              <label key={score.name} className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--ct-line)] px-4 py-3 text-xs text-[var(--ct-text-3)]">
                <span className="flex items-baseline justify-between">
                  <b className="text-[13px] font-semibold text-[var(--ct-text)]">{score.label}</b>
                  <span className={`${mono} text-[18px] text-[var(--ct-text)]`}>{scores[score.name]}</span>
                </span>
                <input
                  type="range"
                  name={score.name}
                  min={1}
                  max={10}
                  value={scores[score.name]}
                  onChange={(event) => setScores({ ...scores, [score.name]: Number(event.target.value) })}
                  className="accent-[var(--ct-accent)]"
                />
                <span className="leading-relaxed">{score.help}</span>
              </label>
            ))}
          </div>
          <p className="text-[13px] text-[var(--ct-text-2)]">
            ICE desta hipótese: <b className={`${mono} text-[var(--ct-text)]`}>{ice.toLocaleString('pt-BR')}</b>
          </p>
        </section>

        <section className="flex flex-col gap-4 border-b border-[var(--ct-line)] pb-6 last:border-b-0 last:pb-0">
          <h2 className="text-[20px] font-semibold">Como o teste vai ser decidido?</h2>
          <Why title="Por que decidir a métrica antes">
            Se a métrica é escolhida depois, é fácil achar uma que favoreça a versão que você já preferia. Combinar antes qual número decide (e quem
            acompanha) evita discussão no fim e deixa o resultado confiável. Os limites de corte e vitória vêm das Regras do jogo do projeto.
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Métrica que decide
            <select name="metric" value={metric} onChange={(event) => setMetric(event.target.value)} className={field}>
              <option value="">Escolha o número que decide</option>
              {(METRICS[method] ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Responsável
            <input name="owner" maxLength={60} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="quem sobe e acompanha o teste" className={field} />
          </label>
        </section>

        <section className="flex flex-col gap-4 border-b border-[var(--ct-line)] pb-6 last:border-b-0 last:pb-0">
          <h2 className="text-[20px] font-semibold">Quais são as variantes?</h2>
          <Why title="Por que a primeira é o controle">
            O controle é o que roda hoje: sem ele não há com o que comparar. Cada linha vira uma variante (A, B, C…), e a Central mede todas contra a A.
            Menos variantes chegam mais rápido a uma resposta; comece com o controle e uma ou duas desafiantes.
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Variantes, uma por linha (a primeira é o controle)
            <textarea
              name="variants"
              rows={4}
              value={variants}
              onChange={(event) => setVariants(event.target.value)}
              placeholder={'Página atual\nPrints de loja na dobra 1'}
              className={field}
            />
          </label>
          {variantNames.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {variantNames.map((name, index) => {
                const key = String.fromCharCode(65 + index)
                return (
                  <div key={key} className="flex items-center gap-3 rounded-[10px] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px]">
                    <span className={`${mono} text-[var(--ct-text-3)]`}>{key}</span>
                    <span className="min-w-0 truncate">{name}</span>
                    {index === 0 && <span className="text-[11px] text-[var(--ct-text-3)]">controle</span>}
                    {method === 'meta' && <code className={`${mono} ml-auto text-[11.5px] text-[var(--ct-accent)]`}>[{nextCode}-{key}]</code>}
                  </div>
                )
              })}
              {method === 'meta' && (
                <p className="text-[12px] text-[var(--ct-text-3)]">Coloque a tag no nome do anúncio de cada variante: é por ela que a Central encontra e mede cada uma.</p>
              )}
            </div>
          )}
          {method === 'link' && (
            <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] px-4 py-4">
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" name="create_link" checked={createLink} onChange={(event) => setCreateLink(event.target.checked)} className="mt-0.5" />
                <span>
                  <b>Criar o teste A/B e o link /r agora</b>
                  <span className="block text-[12px] text-[var(--ct-text-3)]">
                    As variantes acima viram as do teste, com pesos iguais. O link fica pausado (todos vão para o controle) até o card ir para Rodando.
                  </span>
                </span>
              </label>
              {createLink && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                      Tipo
                      <select name="test_type" value={testType} onChange={(event) => setTestType(event.target.value as 'page' | 'checkout')} className={field}>
                        <option value="page">Teste de página</option>
                        <option value="checkout">Teste de checkout</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                      Conta como conversão
                      <select name="conversion_method" value={conversionMethod} onChange={(event) => setConversionMethod(event.target.value as typeof conversionMethod)} className={field}>
                        <option value="hubla_webhook">Venda confirmada (Hubla)</option>
                        <option value="thank_you_page">Captura (página de obrigado)</option>
                      </select>
                    </label>
                  </div>
                  {testType === 'checkout' && (
                    <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                      Página de vendas (a mesma para todos; o botão de comprar aponta para o /c)
                      <input name="sales_page_url" value={salesPageUrl} onChange={(event) => setSalesPageUrl(event.target.value)} placeholder="https://" className={field} />
                    </label>
                  )}
                  {variantNames.map((name, index) => (
                    <label key={index} className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                      {String.fromCharCode(65 + index)} · {name} · {testType === 'checkout' ? 'link do checkout' : 'URL da página'}
                      <input
                        name={`url_${index}`}
                        value={urls[index] ?? ''}
                        onChange={(event) => setUrls((previous) => Object.assign([...previous], { [index]: event.target.value }))}
                        placeholder="https://"
                        className={field}
                      />
                    </label>
                  ))}
                </>
              )}
            </div>
          )}
        </section>


        {problem && (
          <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-2.5 text-[13px] text-[var(--ct-crit)]">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ct-line)] pt-4">
          <Link href={cancelHref} className="text-[13px] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            Cancelar
          </Link>
            <button type="submit" className="ml-auto rounded-full bg-[var(--ct-accent)] px-5 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
              {linkNow ? 'Criar e gerar o link' : 'Criar na fila'}
            </button>
        </div>
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
        {method === 'link' ? (
          <SampleCalculator rules={rules} arms={variantNames.length} />
        ) : (
          <div className="rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-4 text-[12.5px] leading-relaxed text-[var(--ct-text-2)]">
            <b className="mb-1 block text-[14px] text-[var(--ct-text)]">Como este teste decide</b>
            {method === 'meta'
              ? 'Pelas Regras do jogo do projeto: vence o criativo com CPA no teto e compras suficientes; corta o que gasta o limite sem vender. A calculadora de amostra vale para o A/B de link.'
              : 'Compara os dias antes e depois da mudança. É o método menos confiável: o resto também muda com o tempo.'}
          </div>
        )}
        <p className="px-1 text-[12px] text-[var(--ct-text-3)]">
          ICE {ice.toLocaleString('pt-BR')} (I{scores.impact} C{scores.confidence} F{scores.ease}) · entra na Fila ordenada por ele.
        </p>
      </aside>
    </form>
  )
}
