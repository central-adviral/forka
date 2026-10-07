'use client'

import { useState } from 'react'
import Link from 'next/link'

// "Nova hipótese" as a guided setup: one step per decision, each saying what it is and why it
// matters. Every field stays in the one form, so the server action gets the same fields as before.

type Option = { value: string; label: string }

const STEPS = [
  { title: 'A ideia', hint: 'o que muda e por quê' },
  { title: 'Onde e como', hint: 'etapa do funil e método' },
  { title: 'Prioridade', hint: 'impacto, confiança, facilidade' },
  { title: 'Como decidir', hint: 'métrica e responsável' },
  { title: 'Variantes', hint: 'controle e desafiantes' },
  { title: 'Revisão', hint: 'confere e cria' },
] as const

const METHOD_HELP: Record<string, string> = {
  meta: 'As variantes são anúncios no Meta. Cada anúncio leva a tag da variante no nome, e a Central mede gasto, compras (ou leads) e CPA por tag. Use para testar criativo, gancho, copy ou formato.',
  link: 'Um link /r divide o tráfego entre páginas (ou checkouts). A Central conta por pessoa e calcula a chance de cada variante vencer o controle. Use para testar página, oferta ou checkout.',
  antes: 'Muda tudo de uma vez numa data e compara os dias antes e depois. Use só quando não dá para dividir o tráfego: é o método menos confiável, porque o resto também muda com o tempo.',
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
}: {
  action: (formData: FormData) => void | Promise<void>
  cancelHref: string
  nextCode: string
  stages: Option[]
  methods: Option[]
}) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [stage, setStage] = useState('pagina')
  const [method, setMethod] = useState('meta')
  const [scores, setScores] = useState({ impact: 5, confidence: 5, ease: 5 })
  const [metric, setMetric] = useState('')
  const [owner, setOwner] = useState('')
  const [variants, setVariants] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const variantNames = variants.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, 26)
  const ice = Math.round(((scores.impact + scores.confidence + scores.ease) / 3) * 10) / 10
  const stageLabel = stages.find((option) => option.value === stage)?.label ?? stage
  const methodLabel = methods.find((option) => option.value === method)?.label ?? method

  // What keeps a step from moving on; the server checks the same rules again on submit.
  function blocker(at: number): string | null {
    if (at === 0 && !title.trim()) return 'Dê um título para a hipótese.'
    if (at === 4 && variantNames.length < 2) return 'Liste pelo menos duas variantes: o controle e uma desafiante.'
    return null
  }

  function go(to: number) {
    if (to > step) {
      for (let at = step; at < to; at++) {
        const reason = blocker(at)
        if (reason) {
          setStep(at)
          setProblem(reason)
          return
        }
      }
    }
    setProblem(null)
    setStep(to)
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const reason = blocker(0) ?? blocker(4)
        if (reason) {
          event.preventDefault()
          setProblem(reason)
        }
      }}
      className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]"
    >
      <ol className="card-shadow flex flex-col gap-0.5 rounded-[22px] border border-[var(--ct-line)] p-2.5" aria-label="Passos da nova hipótese">
        {STEPS.map((item, index) => {
          const state = index < step ? 'done' : index === step ? 'cur' : 'next'
          return (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => go(index)}
                aria-current={state === 'cur' ? 'step' : undefined}
                className={`grid w-full grid-cols-[26px_minmax(0,1fr)] items-start gap-2.5 rounded-[14px] p-2.5 text-left ${state === 'cur' ? 'bg-[var(--ct-surface-2)]' : 'hover:bg-[var(--ct-surface-2)]'}`}
              >
                <span
                  className={`${mono} grid h-6 w-6 place-items-center rounded-full border text-[11px] ${
                    state === 'done'
                      ? 'border-transparent bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]'
                      : state === 'cur'
                        ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)] text-[var(--ct-on-accent)]'
                        : 'border-[var(--ct-line-2)] text-[var(--ct-text-3)]'
                  }`}
                >
                  {state === 'done' ? '✓' : index + 1}
                </span>
                <span>
                  <b className="block text-[13px] font-medium">{item.title}</b>
                  <span className="block text-[11.5px] text-[var(--ct-text-3)]">{item.hint}</span>
                </span>
              </button>
            </li>
          )
        })}
        <li className="px-2.5 pb-1.5 pt-2">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ct-surface-3)]">
            <i className="block h-full rounded-full bg-[var(--ct-accent)]" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </li>
      </ol>

      <div className="card-shadow flex min-w-0 flex-col gap-5 rounded-[22px] border border-[var(--ct-line)] px-6 py-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`${mono} text-[11px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>
            Nova hipótese · passo {step + 1} de {STEPS.length}
          </span>
          <span className={`${mono} ml-auto rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]`}>{nextCode}</span>
        </div>

        <section hidden={step !== 0} className="flex flex-col gap-4">
          <h2 className="text-[20px] font-semibold">Qual é a ideia?</h2>
          <Why title="Por que escrever a hipótese">
            Um teste sem hipótese só diz qual versão ganhou, não o porquê. Escrever &quot;se mudarmos X, Y melhora porque Z&quot; obriga a dizer o que você
            espera e por quê; no fim, o aprendizado é a resposta a esse porquê, e é ele que vale para os próximos testes.
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Título curto (aparece no card do quadro)
            <input name="title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ex.: Prova social acima da dobra" className={field} />
          </label>
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

        <section hidden={step !== 1} className="flex flex-col gap-4">
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

        <section hidden={step !== 2} className="flex flex-col gap-4">
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

        <section hidden={step !== 3} className="flex flex-col gap-4">
          <h2 className="text-[20px] font-semibold">Como o teste vai ser decidido?</h2>
          <Why title="Por que decidir a métrica antes">
            Se a métrica é escolhida depois, é fácil achar uma que favoreça a versão que você já preferia. Combinar antes qual número decide (e quem
            acompanha) evita discussão no fim e deixa o resultado confiável. Os limites de corte e vitória vêm das Regras do jogo do projeto.
          </Why>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Métrica que decide
            <input
              name="metric"
              maxLength={120}
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
              placeholder={method === 'link' ? 'ex.: conversão da página por pessoa' : method === 'meta' ? 'ex.: CTR, depois CPA de anúncio' : 'ex.: CPA geral, 7 dias antes e depois'}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Responsável
            <input name="owner" maxLength={60} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="quem sobe e acompanha o teste" className={field} />
          </label>
        </section>

        <section hidden={step !== 4} className="flex flex-col gap-4">
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
        </section>

        <section hidden={step !== 5} className="flex flex-col gap-4">
          <h2 className="text-[20px] font-semibold">Confere e cria</h2>
          <Why title="O que acontece depois">
            A hipótese entra na Fila, ordenada pelo ICE. Ela ganha uma lista de pré-requisitos (por exemplo, criar os anúncios com a tag) e só pode ir para
            Rodando quando todos estiverem feitos. Para decidir, a Central pede o aprendizado: é o que fica para os próximos testes.
          </Why>
          <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[150px_minmax(0,1fr)]">
            <dt className="text-[var(--ct-text-3)]">Título</dt>
            <dd>{title || '—'}</dd>
            <dt className="text-[var(--ct-text-3)]">Hipótese</dt>
            <dd className="text-[var(--ct-text-2)]">{hypothesis || '—'}</dd>
            <dt className="text-[var(--ct-text-3)]">Etapa e método</dt>
            <dd>
              {stageLabel} · {methodLabel}
            </dd>
            <dt className="text-[var(--ct-text-3)]">ICE</dt>
            <dd className={mono}>
              {ice.toLocaleString('pt-BR')} (I{scores.impact} C{scores.confidence} F{scores.ease})
            </dd>
            <dt className="text-[var(--ct-text-3)]">Decide por</dt>
            <dd>{metric || '—'}{owner ? ` · ${owner}` : ''}</dd>
            <dt className="text-[var(--ct-text-3)]">Variantes</dt>
            <dd>{variantNames.map((name, index) => `${String.fromCharCode(65 + index)} ${name}`).join(' · ') || '—'}</dd>
          </dl>
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
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="ml-auto rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
              Voltar
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => go(step + 1)}
              className={`${step === 0 ? 'ml-auto' : ''} rounded-full bg-[var(--ct-accent)] px-5 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110`}
            >
              Continuar
            </button>
          ) : (
            <button type="submit" className="rounded-full bg-[var(--ct-accent)] px-5 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
              Criar na fila
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
