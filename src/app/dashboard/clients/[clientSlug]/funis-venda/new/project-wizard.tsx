'use client'

import { useMemo, useState, useTransition } from 'react'
import { PROJECT_RESULTS, type ProjectResult } from '@/lib/domain/project-plan'
import { PRODUCT_ROLES, PRODUCT_ROLE_HINT, PRODUCT_ROLE_LABEL, type ProductRole } from '@/lib/domain/product-roles'
import type { LaunchOpsProduct } from '@/lib/launchops/products'
import {
  DEFAULT_TARGET,
  METRIC_KEYS,
  MODELS,
  PAGE_KINDS,
  PAGE_KIND_LABEL,
  applyModel,
  blocksDraft,
  coherence,
  duplicateProject,
  emptyProject,
  frontMetrics,
  frontTag,
  isBlocked,
  metricLabel,
  needsProducts,
  newFront,
  pageConflict,
  previewFront,
  rename,
  seals,
  slugify,
  type ExistingPage,
  type PreviewCampaign,
  type ProjectModel,
  type Seal,
  type SourceProject,
  type WizardFront,
  type WizardProject,
} from '@/lib/domain/project-wizard'
import { CopyButton } from '@/components/copy-button'
import { createProject } from './actions'

const STEPS = ['Funil', 'Frentes', 'Produtos', 'Conferir']
const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'min-h-[42px] rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 text-[13.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const label = 'flex min-w-0 flex-col gap-1.5 text-[12.5px] text-[var(--ct-text-2)]'
const pill = (on: boolean) =>
  `min-h-[38px] rounded-full border px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
    on ? 'border-[var(--ct-text)] bg-[var(--ct-text)] text-[var(--ct-surface)]' : 'border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] text-[var(--ct-text)]'
  }`
const button = 'min-h-[40px] rounded-full border border-[var(--ct-line-2)] px-4 text-[13px] font-medium text-[var(--ct-text)] hover:bg-[var(--ct-surface-2)] disabled:opacity-50'
const primaryButton = 'min-h-[42px] rounded-full bg-[var(--ct-accent)] px-5 text-[13.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
const SEAL_TONE: Record<Seal['tone'], string> = {
  crit: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]',
  warn: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
  info: 'bg-[var(--ct-surface-2)] text-[var(--ct-text-2)]',
}

const brl = (value: number) => (Number.isFinite(value) ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }) : '—')
const targetText = (metric: ProjectResult, target: number) =>
  PROJECT_RESULTS[metric].higherIsBetter ? `≥ ${target.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : `≤ ${brl(target)}`
const numberValue = (value: number) => (Number.isFinite(value) && value !== 0 ? value : '')

interface Props {
  context: { client_id: string; client_slug: string }
  campaigns: PreviewCampaign[]
  existingPages: ExistingPage[]
  activePages: number
  takenSlugs: string[]
  sources: SourceProject[]
  catalog: LaunchOpsProduct[]
  catalogError: string | null
}

export function ProjectWizard(props: Props) {
  const [project, setProject] = useState<WizardProject>(emptyProject)
  const [step, setStep] = useState(0)
  const [done, setDone] = useState<number[]>([])
  const [conversion, setConversion] = useState(3)
  const [ticket, setTicket] = useState<number | null>(null)
  const [duplicateId, setDuplicateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const context = { campaigns: props.campaigns, existingPages: props.existingPages, activePages: props.activePages, takenSlugs: props.takenSlugs }
  const found = seals(project, context)
  const entryTicket = useMemo(() => {
    const entries = props.catalog.filter((product) => project.products[product.produto_nome] === 'entrada')
    return entries.length ? entries.reduce((sum, product) => sum + product.ticket, 0) / entries.length : 0
  }, [props.catalog, project.products])

  const setFront = (index: number, patch: Partial<WizardFront>) =>
    setProject((current) => ({ ...current, fronts: current.fronts.map((front, i) => (i === index ? { ...front, ...patch } : front)) }))
  const setPage = (frontIndex: number, pageIndex: number, patch: Partial<WizardFront['pages'][number]>) =>
    setFront(frontIndex, { pages: project.fronts[frontIndex].pages.map((page, i) => (i === pageIndex ? { ...page, ...patch, review: false } : page)) })
  const go = (next: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, next)))

  function save(ligar: boolean) {
    setError(null)
    startTransition(async () => {
      // Success redirects to the new project (a client-side navigation); only a refusal comes back.
      const result = await createProject(props.context, project, ligar)
      if (result?.error) setError(result.error)
    })
  }

  const stepProjeto = (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[17px] font-semibold">1. Funil</h2>
        {props.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Funil para duplicar" value={duplicateId} onChange={(event) => setDuplicateId(event.target.value)} className={field}>
              <option value="">Duplicar de um funil anterior…</option>
              {props.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={button}
              disabled={!duplicateId}
              onClick={() => setProject((current) => duplicateProject(current, props.sources.find((source) => source.id === duplicateId)!))}
            >
              Duplicar
            </button>
          </div>
        )}
      </div>
      {project.duplicatedFrom && (
        <p className="rounded-[12px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">
          Copiado de {project.duplicatedFrom}: frentes, métricas, produtos e páginas. As etiquetas passaram para a etiqueta do funil novo. Revise as páginas antes de ligar.
        </p>
      )}
      <div className={label}>
        Modelo
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
          {(Object.keys(MODELS) as ProjectModel[]).map((model) => (
            <button
              key={model}
              type="button"
              aria-pressed={project.model === model}
              onClick={() => setProject((current) => applyModel(current, model))}
              className={`flex min-h-[44px] flex-col gap-1 rounded-[14px] border px-3.5 py-3 text-left ${
                project.model === model ? 'border-[var(--ct-accent)] bg-[var(--ct-accent-soft)]' : 'border-[var(--ct-line)] bg-[var(--ct-surface-2)]'
              }`}
            >
              <b className="text-[14.5px] text-[var(--ct-text)]">{MODELS[model].label}</b>
              <span className="text-[12.5px] text-[var(--ct-text-2)]">{MODELS[model].text}</span>
              <span className={`${mono} text-[11.5px] text-[var(--ct-text-3)]`}>
                {metricLabel(MODELS[model].primary)} + {metricLabel(MODELS[model].secondary)} · {MODELS[model].fronts.length} frentes
              </span>
            </button>
          ))}
        </div>
      </div>
      <label className={label}>
        Nome
        <input value={project.name} maxLength={80} onChange={(event) => setProject((current) => rename(current, event.target.value))} placeholder="ex.: 1K LATAM" className={field} />
      </label>
      <details>
        <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)]">
          Avançado · endereço interno <span className={mono}>/{project.slug || '…'}</span>
        </summary>
        <label className={`${label} mt-2`}>
          Endereço interno (letras minúsculas, números e hífen)
          <input
            value={project.slug}
            onChange={(event) => setProject((current) => ({ ...current, slug: slugify(event.target.value), slugEdited: true }))}
            className={`${field} ${mono}`}
          />
        </label>
      </details>
      <div className={label}>
        Métrica principal do funil
        <MetricPicker
          value={project.primary}
          onChange={(metric) =>
            setProject((current) => {
              const secondary = current.secondary === metric ? METRIC_KEYS.find((other) => other !== metric)! : current.secondary
              return { ...current, primary: metric, primaryTarget: DEFAULT_TARGET[metric], secondary, secondaryTarget: secondary === current.secondary ? current.secondaryTarget : DEFAULT_TARGET[secondary] }
            })
          }
        />
      </div>
      <div className={label}>
        Métrica secundária do funil
        <MetricPicker value={project.secondary} disabled={project.primary} onChange={(metric) => setProject((current) => ({ ...current, secondary: metric, secondaryTarget: DEFAULT_TARGET[metric] }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Meta principal ({metricLabel(project.primary)})
          <input type="number" step="0.01" min="0" value={numberValue(project.primaryTarget)} onChange={(event) => setProject((current) => ({ ...current, primaryTarget: Number(event.target.value) }))} className={`${field} ${mono}`} />
        </label>
        <label className={label}>
          Meta secundária ({metricLabel(project.secondary)})
          <input type="number" step="0.01" min="0" value={numberValue(project.secondaryTarget)} onChange={(event) => setProject((current) => ({ ...current, secondaryTarget: Number(event.target.value) }))} className={`${field} ${mono}`} />
        </label>
        <label className={label}>
          Início
          <input type="date" value={project.startsOn} onChange={(event) => setProject((current) => ({ ...current, startsOn: event.target.value }))} className={field} />
        </label>
        <label className={label}>
          Fim
          <input type="date" value={project.endsOn} onChange={(event) => setProject((current) => ({ ...current, endsOn: event.target.value }))} className={field} />
        </label>
      </div>
      <p className="rounded-[12px] bg-[var(--ct-accent-soft)] px-4 py-3 text-[13px] text-[var(--ct-text)]">
        Principal e secundária são o que o Resumo do funil destaca e o que gera alerta do funil. Todas as outras métricas do caminho de conversão continuam nas análises. O modelo só preenche: tudo é editável.
      </p>
    </>
  )

  const stepFrentes = (
    <>
      <h2 className="text-[17px] font-semibold">2. Frentes</h2>
      <p className="text-[13px] text-[var(--ct-text-2)]">Cada frente diz de onde vem o gasto (a etiqueta das campanhas) e para onde vão as pessoas (as páginas). Métricas próprias são opcionais.</p>
      {project.fronts.map((front, index) => {
        const preview = previewFront(project, front, props.campaigns)
        const metrics = frontMetrics(project, front)
        return (
          <section key={front.key} aria-label={`Frente ${front.name}`} className="overflow-hidden rounded-[16px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ct-line)] px-3.5 py-3">
              <input
                aria-label="Código da frente"
                value={front.code}
                maxLength={24}
                onChange={(event) => {
                  const code = event.target.value.toUpperCase().replace(/\s+/g, '')
                  setFront(index, { code, tag: front.tagEdited ? front.tag : frontTag(project.name, code) })
                }}
                className={`${field} ${mono} w-24`}
              />
              <input aria-label="Nome da frente" value={front.name} maxLength={60} onChange={(event) => setFront(index, { name: event.target.value })} className={`${field} min-w-0 flex-1 basis-40`} />
              <div className="flex rounded-full border border-[var(--ct-line-2)] p-0.5" role="group" aria-label="Tipo da frente">
                {(['propria', 'espelho'] as const).map((kind) => (
                  <button key={kind} type="button" aria-pressed={front.kind === kind} onClick={() => setFront(index, kind === 'espelho' && !front.windowStart && !front.windowEnd ? { kind, windowStart: project.startsOn, windowEnd: project.endsOn } : { kind })} className={`min-h-[34px] rounded-full px-3 text-[12.5px] ${front.kind === kind ? 'bg-[var(--ct-text)] text-[var(--ct-surface)]' : ''}`}>
                    {kind === 'propria' ? 'Própria' : 'Espelho'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remover frente ${front.name}`}
                onClick={() => setProject((current) => ({ ...current, fronts: current.fronts.filter((_, i) => i !== index) }))}
                className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border border-[var(--ct-line-2)] text-[18px]"
              >
                ×
              </button>
            </div>
            <div className="grid gap-4 p-3.5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Gasto</span>
                {front.kind === 'propria' ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Etiqueta da frente ${front.name}`}
                        value={front.tag}
                        onChange={(event) => setFront(index, { tag: event.target.value, tagEdited: true })}
                        className={`${field} ${mono} min-w-0 flex-1`}
                      />
                      <CopyButton text={front.tag} />
                    </div>
                    <span className="text-[12px] text-[var(--ct-text-3)]">Use esta etiqueta no nome das campanhas no Meta Ads. Vira a etiqueta da frente.</span>
                    <div className="text-[12.5px]" aria-live="polite">
                      {!front.tag.trim() ? (
                        <b className="text-[var(--ct-crit)]">Sem etiqueta: a frente não pega nenhuma campanha.</b>
                      ) : (
                        <>
                          <b>{preview.campaigns.length}</b> campanhas · <b>{brl(preview.spend)}</b> em 30 dias
                          {preview.disputed.length > 0 && <b className="text-[var(--ct-crit)]"> · {preview.disputed.length} em disputa com outra frente</b>}
                          {preview.foreign.length > 0 && <b className="text-[var(--ct-warn)]"> · {preview.foreign.length} de outro funil</b>}
                          {preview.campaigns.length ? (
                            <ul className={`${mono} mt-1 flex flex-col gap-0.5 text-[11.5px] text-[var(--ct-text-2)]`}>
                              {preview.campaigns.slice(0, 8).map((campaign) => (
                                <li key={campaign.campaign_name} className="truncate">
                                  {campaign.campaign_name}
                                </li>
                              ))}
                              {preview.campaigns.length > 8 && <li>+ {preview.campaigns.length - 8}</li>}
                            </ul>
                          ) : (
                            <p className="text-[12px] text-[var(--ct-text-3)]">Nenhuma campanha com essa etiqueta ainda. A frente fica aguardando campanhas.</p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <label className={label}>
                      Lê o gasto do funil
                      <select value={front.sourceProjectId ?? ''} onChange={(event) => setFront(index, { sourceProjectId: event.target.value || null })} className={field}>
                        <option value="">escolha…</option>
                        {props.sources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className={label}>
                        Janela: início
                        <input type="date" value={front.windowStart} onChange={(event) => setFront(index, { windowStart: event.target.value })} className={field} />
                      </label>
                      <label className={label}>
                        Janela: fim
                        <input type="date" value={front.windowEnd} onChange={(event) => setFront(index, { windowEnd: event.target.value })} className={field} />
                      </label>
                    </div>
                    <span className="text-[12px] text-[var(--ct-text-3)]">O espelho só soma o gasto do outro funil nos dias dentro desta janela. As vendas ficam com o funil dono.</span>
                  </>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Métricas da frente</span>
                <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
                  <input type="checkbox" checked={front.own} onChange={(event) => setFront(index, { own: event.target.checked })} className="mt-0.5 h-[18px] w-[18px] accent-[var(--ct-accent)]" />
                  <span>
                    <b>Usar métricas próprias nesta frente</b>
                    <br />
                    <span className="text-[12px] text-[var(--ct-text-3)]">Desligado: a frente segue o funil e não tem alerta próprio.</span>
                  </span>
                </label>
                {front.own ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MetricSelect name="Métrica principal da frente" value={front.primary} onChange={(metric) => setFront(index, { primary: metric, primaryTarget: DEFAULT_TARGET[metric], ...(front.secondary === metric ? { secondary: METRIC_KEYS.find((other) => other !== metric)!, secondaryTarget: DEFAULT_TARGET[METRIC_KEYS.find((other) => other !== metric)!] } : {}) })} />
                    <input aria-label="Meta principal da frente" type="number" step="0.01" min="0" value={numberValue(front.primaryTarget)} onChange={(event) => setFront(index, { primaryTarget: Number(event.target.value) })} className={`${field} ${mono}`} />
                    <MetricSelect name="Métrica secundária da frente" value={front.secondary} disabled={front.primary} onChange={(metric) => setFront(index, { secondary: metric, secondaryTarget: DEFAULT_TARGET[metric] })} />
                    <input aria-label="Meta secundária da frente" type="number" step="0.01" min="0" value={numberValue(front.secondaryTarget)} onChange={(event) => setFront(index, { secondaryTarget: Number(event.target.value) })} className={`${field} ${mono}`} />
                  </div>
                ) : (
                  <span className="text-[13px] text-[var(--ct-text-2)]">
                    Segue o funil: {metricLabel(metrics.primary)} (principal) e {metricLabel(metrics.secondary)} (secundária).
                  </span>
                )}
              </div>
              {front.kind === 'propria' && (
                <div className="flex min-w-0 flex-col gap-2 [grid-column:1/-1]">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Páginas da frente</span>
                  {front.pages.map((page, pageIndex) => {
                    const conflict = page.url.trim() ? pageConflict(project, index, pageIndex, props.existingPages) : null
                    return (
                      <div key={pageIndex} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
                        <input type="url" aria-label="Endereço da página" placeholder="https://..." value={page.url} onChange={(event) => setPage(index, pageIndex, { url: event.target.value })} className={`${field} min-w-0`} />
                        <select aria-label="Tipo da página" value={page.kind} onChange={(event) => setPage(index, pageIndex, { kind: event.target.value as typeof page.kind })} className={field}>
                          {PAGE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {PAGE_KIND_LABEL[kind]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="Tirar página"
                          onClick={() => setFront(index, { pages: front.pages.filter((_, i) => i !== pageIndex) })}
                          className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border border-[var(--ct-line-2)] text-[18px]"
                        >
                          ×
                        </button>
                        {conflict && <span className="col-span-3 text-[12px] font-semibold text-[var(--ct-crit)]">Esta página já está em {conflict}. Cada página fica em uma frente só.</span>}
                        {!conflict && page.review && page.url.trim() && <span className="col-span-3 text-[12px] text-[var(--ct-warn)]">Copiada do funil anterior: confira o endereço.</span>}
                      </div>
                    )
                  })}
                  {front.pages.length === 0 && <span className="text-[13px] text-[var(--ct-text-3)]">Nenhuma página.</span>}
                  <button type="button" onClick={() => setFront(index, { pages: [...front.pages, { kind: 'vendas', url: '' }] })} className={`${button} self-start`}>
                    + Página
                  </button>
                </div>
              )}
            </div>
          </section>
        )
      })}
      <button
        type="button"
        className={`${button} self-start`}
        onClick={() =>
          setProject((current) => ({
            ...current,
            fronts: [...current.fronts, newFront(current.name, { name: 'Nova frente', code: `F${current.fronts.length + 1}` }, current)],
          }))
        }
      >
        + Nova frente
      </button>
    </>
  )

  const needs = needsProducts(project)
  const stepProdutos = (
    <>
      <h2 className="text-[17px] font-semibold">3. Produtos</h2>
      {needs ? (
        <p className="text-[13px] text-[var(--ct-text-2)]">Alguma métrica escolhida depende de venda. Marque da lista do LaunchOps e escolha o papel. Só &quot;entrada&quot; conta no CPA.</p>
      ) : (
        <p className="rounded-[12px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">Nenhuma métrica escolhida depende de venda. Produtos são opcionais: servem para mostrar receita nas análises. Pode pular.</p>
      )}
      {props.catalogError && <p className="rounded-[12px] bg-[var(--ct-warn-soft)] px-4 py-3 text-[13px] text-[var(--ct-warn)]">{props.catalogError}</p>}
      {props.catalog.map((product) => {
        const role = project.products[product.produto_nome]
        const id = `produto-${product.produto_nome}`
        return (
          <div key={product.produto_nome} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(role)}
              onChange={(event) =>
                setProject((current) => {
                  const products = { ...current.products }
                  if (event.target.checked) products[product.produto_nome] = 'entrada'
                  else delete products[product.produto_nome]
                  return { ...current, products }
                })
              }
              className="h-[18px] w-[18px] accent-[var(--ct-accent)]"
            />
            <label htmlFor={id} className="min-w-0 text-[13.5px]">
              <b>{product.produto_nome}</b>{' '}
              <span className="text-[12.5px] text-[var(--ct-text-3)]">
                · ticket {brl(product.ticket)} · {product.vendas} vendas em 30 dias
              </span>
            </label>
            <select
              aria-label={`Papel de ${product.produto_nome}`}
              disabled={!role}
              value={role ?? 'entrada'}
              onChange={(event) => setProject((current) => ({ ...current, products: { ...current.products, [product.produto_nome]: event.target.value as ProductRole } }))}
              className={`${field} col-span-2 sm:col-span-1`}
            >
              {PRODUCT_ROLES.map((option) => (
                <option key={option} value={option}>
                  {PRODUCT_ROLE_LABEL[option]} ({PRODUCT_ROLE_HINT[option]})
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </>
  )

  const fit = coherence(project, conversion, ticket ?? entryTicket)
  const blocked = isBlocked(found)
  const stepConferir = (
    <>
      <h2 className="text-[17px] font-semibold">4. Conferir e ligar</h2>
      <section className="flex flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Metas coerentes</span>
        {fit?.kind === 'cpl_cpa' && (
          <>
            <label className={label}>
              <span>
                Conversão lead → compra: <b className="text-[var(--ct-text)]">{conversion.toLocaleString('pt-BR')}%</b>
              </span>
              <input type="range" min="0.5" max="10" step="0.1" value={conversion} onChange={(event) => setConversion(Number(event.target.value))} className="accent-[var(--ct-accent)]" />
            </label>
            <Boxes items={[['Meta de CPL', brl(fit.cpl)], ['÷ conversão', `${conversion.toLocaleString('pt-BR')}%`], ['= CPA projetado', brl(fit.projectedCpa), fit.ok], ['Meta de CPA', brl(fit.cpa)]]} />
            <p className={`rounded-[12px] px-4 py-3 text-[13px] ${fit.ok ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'}`}>
              {fit.ok
                ? `As metas fecham: com ${conversion.toLocaleString('pt-BR')}% de conversão, o CPL de ${brl(fit.cpl)} entrega CPA de ${brl(fit.projectedCpa)}, dentro da meta.`
                : `As metas não fecham. Para o CPA de ${brl(fit.cpa)}, você precisa de CPL até ${brl(fit.neededCpl)} ou conversão de ${fit.neededConversionPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%.`}
            </p>
          </>
        )}
        {fit?.kind === 'roas_cpa' && (
          <>
            <label className={label}>
              Ticket médio de entrada (R$)
              <input type="number" min="0" step="0.01" value={ticket ?? (entryTicket ? Math.round(entryTicket * 100) / 100 : '')} onChange={(event) => setTicket(Number(event.target.value))} className={`${field} ${mono}`} />
            </label>
            <Boxes items={[['Ticket', brl(fit.ticket)], ['÷ meta de ROAS', `${fit.roas.toLocaleString('pt-BR')}x`], ['= CPA máximo', brl(fit.maxCpa), fit.ok], ['Meta de CPA', brl(fit.cpa)]]} />
            <p className={`rounded-[12px] px-4 py-3 text-[13px] ${fit.ok ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'}`}>
              {fit.ok
                ? 'As metas fecham: a meta de CPA cabe dentro do ROAS pedido.'
                : `As metas não fecham: com ticket de ${brl(fit.ticket)} e ROAS ${fit.roas.toLocaleString('pt-BR')}x, o CPA precisa ficar até ${brl(fit.maxCpa)}.`}
            </p>
          </>
        )}
        {!fit && <p className="text-[13px] text-[var(--ct-text-2)]">Esta combinação de métricas não tem uma conta de coerência direta. As duas são acompanhadas separadamente.</p>}
      </section>
      <section className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">O que falta</span>
        <SealList list={found} onGo={go} action="Resolver" />
      </section>
      {error && (
        <p role="alert" className="rounded-[12px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButton} disabled={blocked || isPending} onClick={() => save(true)}>
          Ligar funil
        </button>
        <button type="button" className={button} disabled={blocksDraft(found) || isPending} onClick={() => save(false)}>
          Salvar como rascunho
        </button>
        <span className="text-[12.5px] text-[var(--ct-text-3)]">
          {blocked ? 'Resolva os itens críticos para ligar. O rascunho não sincroniza nem alerta.' : 'Ligado, o funil sincroniza, vigia e alerta.'}
        </span>
      </div>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Passos" className="flex gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((name, index) => (
          <button
            key={name}
            type="button"
            aria-current={step === index ? 'step' : undefined}
            onClick={() => go(index)}
            className={`flex min-h-[42px] flex-none items-center gap-2 rounded-full border bg-[var(--ct-surface)] py-1.5 pl-1.5 pr-3.5 text-[13.5px] ${
              step === index ? 'border-[var(--ct-accent)] shadow-[0_0_0_3px_var(--ct-accent-soft)]' : 'border-[var(--ct-line)]'
            }`}
          >
            <span
              className={`${mono} grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold ${
                step === index ? 'bg-[var(--ct-accent)] text-[var(--ct-on-accent)]' : done.includes(index) ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]'
              }`}
            >
              {done.includes(index) && step !== index ? '✓' : index + 1}
            </span>
            {name}
          </button>
        ))}
      </nav>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 rounded-[18px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-5">
          {[stepProjeto, stepFrentes, stepProdutos, stepConferir][step]}
          <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--ct-line)] pt-4">
            <button type="button" className={button} disabled={step === 0} onClick={() => go(step - 1)}>
              Voltar
            </button>
            {step < STEPS.length - 1 && (
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  setDone((current) => (current.includes(step) ? current : [...current, step]))
                  go(step + 1)
                }}
              >
                Concluir e seguir
              </button>
            )}
          </div>
        </div>
        <LiveCard project={project} campaigns={props.campaigns} sources={props.sources} found={found} onGo={go} />
      </div>
    </div>
  )
}

function MetricPicker({ value, onChange, disabled }: { value: ProjectResult; onChange: (metric: ProjectResult) => void; disabled?: ProjectResult }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {METRIC_KEYS.map((metric) => (
        <button key={metric} type="button" aria-pressed={value === metric} disabled={disabled === metric} onClick={() => onChange(metric)} className={pill(value === metric)}>
          {metricLabel(metric)} <span className="text-[11.5px] opacity-70">{PROJECT_RESULTS[metric].label.toLowerCase()}</span>
        </button>
      ))}
    </div>
  )
}

function MetricSelect({ value, onChange, disabled, name }: { value: ProjectResult; onChange: (metric: ProjectResult) => void; disabled?: ProjectResult; name: string }) {
  return (
    <select aria-label={name} value={value} onChange={(event) => onChange(event.target.value as ProjectResult)} className={field}>
      {METRIC_KEYS.map((metric) => (
        <option key={metric} value={metric} disabled={disabled === metric}>
          {metricLabel(metric)}
        </option>
      ))}
    </select>
  )
}

function Boxes({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
      {items.map(([title, value, ok]) => (
        <div key={title} className="flex flex-col gap-1 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-3">
          <small className="text-[12px] text-[var(--ct-text-3)]">{title}</small>
          <b className={`${mono} text-[18px] tabular-nums ${ok === undefined ? '' : ok ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-crit)]'}`}>{value}</b>
        </div>
      ))}
    </div>
  )
}

function SealList({ list, onGo, action }: { list: Seal[]; onGo: (step: number) => void; action: string }) {
  if (list.length === 0) return <p className="rounded-[12px] bg-[var(--ct-ok-soft)] px-3 py-2 text-[13px] text-[var(--ct-ok)]">Nada faltando. Os números deste funil já nascem confiáveis.</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((seal) => (
        <li key={seal.text} className={`flex flex-wrap items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-[13px] ${SEAL_TONE[seal.tone]}`}>
          <span>{seal.text}</span>
          <button type="button" onClick={() => onGo(seal.step)} className="min-h-[32px] rounded-full border border-current px-3 text-[12px]">
            {action}
          </button>
        </li>
      ))}
    </ul>
  )
}

function LiveCard({ project, campaigns, sources, found, onGo }: { project: WizardProject; campaigns: PreviewCampaign[]; sources: SourceProject[]; found: Seal[]; onGo: (step: number) => void }) {
  return (
    <aside aria-label="Cartão do funil" className="flex min-w-0 flex-col gap-3 rounded-[18px] border-2 border-[var(--ct-text)] bg-[var(--ct-surface)] p-5 lg:sticky lg:top-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Cartão do funil</span>
      <b className="text-[20px]">{project.name || 'Sem nome'}</b>
      <span className="self-start rounded-full bg-[var(--ct-warn-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--ct-warn)]">rascunho até ligar</span>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13.5px]">
        <dt className="text-[var(--ct-text-2)]">Principal</dt>
        <dd className={`${mono} text-right`}>
          {metricLabel(project.primary)} {targetText(project.primary, project.primaryTarget)}
        </dd>
        <dt className="text-[var(--ct-text-2)]">Secundária</dt>
        <dd className={`${mono} text-right`}>
          {metricLabel(project.secondary)} {targetText(project.secondary, project.secondaryTarget)}
        </dd>
      </dl>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Frentes ({project.fronts.length})</span>
      {project.fronts.map((front) => {
        const preview = previewFront(project, front, campaigns)
        const metrics = frontMetrics(project, front)
        return (
          <div key={front.key} className="flex flex-col gap-1 rounded-[12px] border border-[var(--ct-line)] px-3 py-2 text-[12.5px]">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <b>
                <span className={`${mono} mr-1.5 rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px]`}>{front.code}</span>
                {front.name}
              </b>
              <span className={`${mono} text-[var(--ct-text-3)]`}>{front.kind === 'espelho' ? 'espelho' : front.tag}</span>
            </span>
            <span className="text-[var(--ct-text-2)]">
              {front.kind === 'espelho'
                ? `lê ${sources.find((source) => source.id === front.sourceProjectId)?.name ?? '—'}${project.startsOn && project.endsOn ? ' na janela' : ' · sem janela'}`
                : `${preview.campaigns.length} campanhas · ${brl(preview.spend)} em 30 dias`}
            </span>
            <span>{metrics.own ? `${metricLabel(metrics.primary)} + ${metricLabel(metrics.secondary)} · próprias` : <span className="text-[var(--ct-text-3)]">segue o funil</span>}</span>
            {front.kind === 'propria' && <span className="text-[var(--ct-text-3)]">{front.pages.filter((page) => page.url.trim()).length} página(s) vigiada(s)</span>}
          </div>
        )
      })}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Produtos</span>
      <span className="text-[12.5px]">
        {Object.keys(project.products).length
          ? Object.entries(project.products).map(([name, role]) => (
              <span key={name} className="block">
                {name} · {PRODUCT_ROLE_LABEL[role]}
              </span>
            ))
          : <span className="text-[var(--ct-text-3)]">nenhum</span>}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-3)]">Selos</span>
      <SealList list={found.slice(0, 5)} onGo={onGo} action="Ir" />
      {found.length > 5 && <span className="text-[12px] text-[var(--ct-text-3)]">+ {found.length - 5} itens</span>}
    </aside>
  )
}
