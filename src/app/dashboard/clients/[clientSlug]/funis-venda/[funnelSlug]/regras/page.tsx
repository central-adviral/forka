import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolvePeriodDateRange } from '@/lib/domain/report-period'
import {
  bracketTags,
  conflictingCampaigns,
  orphanCampaigns,
  reconcileSpend,
  summarizeFronts,
  type ClassifiedCampaign,
} from '@/lib/domain/campaign-rules'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { addRule, createFront, setFrontArchived, pinCampaign, previewRule, removeRule, unpinCampaign, updateFront } from './actions'
import { RuleForm } from './rule-form'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { ApplySincePanel } from '../apply-since-panel'
import { applySince, previewApplySince } from '../apply-since-actions'
import { PROJECT_RESULTS, type ProjectResult } from '@/lib/domain/project-plan'

interface FrontRow {
  id: string
  code: string
  name: string
  position: number
  sales_funnel_id: string
  source_sales_funnel_id: string | null
  metrica_principal: ProjectResult | null
  alvo_principal: number | null
  metrica_secundaria: ProjectResult | null
  alvo_secundaria: number | null
  archived_at: string | null
  sales_funnels: { name: string; archived_at: string | null } | null
  naming_rules: { id: string; kind: 'include' | 'exclude'; value: string }[]
}

const PERIODS = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
] as const

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const ASSIGNMENT_LABEL: Record<NonNullable<ClassifiedCampaign['assignment']>, string> = {
  manual: 'fixada à mão',
  auto: 'fixada pelo nome',
  nome: 'pelo nome · fixa no próximo sync',
}

const mono = 'font-[family-name:var(--font-geist-mono)]'
const fieldClass =
  'rounded-[8px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'

export default async function CampaignRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ periodo?: string; ok?: string; erro?: string; mudou?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { periodo: periodParam, ok, erro, mudou } = await searchParams
  const periodo = periodParam === '30d' ? '30d' : '7d'
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  // Configuration is internal to the agency: the client never reads it, even by typing the address.
  if (!(await canActAs(supabase, client.id, 'analista'))) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, archived_at')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const { since, until } = resolvePeriodDateRange(periodo, undefined, undefined)
  const [{ data: canEditClient }, { data: frontRows, error: frontsError }, { data: campaignRows }, { data: lastSync }, { data: otherFunnels }] = await Promise.all([
    canActAs(supabase, client.id, 'gestor').then((data) => ({ data })),
    supabase
      .from('project_fronts')
      .select('id, code, name, position, sales_funnel_id, source_sales_funnel_id, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria, archived_at, sales_funnels!project_fronts_sales_funnel_id_fkey!inner(name, client_id, archived_at), naming_rules(id, kind, value)')
      .eq('sales_funnels.client_id', client.id)
      .order('position'),
    supabase.rpc('get_client_campaigns', { p_client_id: client.id, p_since: since, p_until: until }),
    supabase.from('campaign_daily').select('synced_at').eq('client_id', client.id).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_funnels').select('id, name, archived_at').eq('client_id', client.id).neq('id', funnel.id).order('name'),
  ])

  if (frontsError) throw frontsError
  const allFronts = (frontRows ?? []) as unknown as FrontRow[]
  // An archived project opens read-only; its archived fronts are listed apart, to restore.
  const canEdit = canEditClient && !funnel.archived_at
  const fronts = allFronts.filter((front) => front.sales_funnel_id === funnel.id && !front.archived_at)
  const archivedFronts = allFronts.filter((front) => front.sales_funnel_id === funnel.id && front.archived_at)
  const frontById = new Map(allFronts.map((front) => [front.id, front]))
  const funnelNameById = new Map((otherFunnels ?? []).map((other) => [other.id as string, other.name as string]))
  // Only fronts with campaigns of their own can own one; a front that reads another project cannot.
  const ownerFronts = allFronts.filter((front) => !front.source_sales_funnel_id && !front.archived_at && !front.sales_funnels?.archived_at)
  const campaigns = (campaignRows ?? []) as ClassifiedCampaign[]
  const summary = summarizeFronts(campaigns, fronts.map((front) => front.id))
  // Archived fronts still own their campaigns: the project's spend keeps them.
  const projectFrontIds = new Set([...fronts, ...archivedFronts].map((front) => front.id))
  const conflicts = conflictingCampaigns(campaigns, projectFrontIds)
  const orphans = orphanCampaigns(campaigns)
  const unclassifiedSpend = campaigns
    .filter((campaign) => campaign.front_ids.length === 0)
    .reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const orphanSpend = orphans.reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const projectSpend = campaigns
    .filter((campaign) => campaign.front_ids.some((id) => projectFrontIds.has(id)))
    .reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const tags = bracketTags(campaigns)

  const base = `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`
  const context = { client_slug: client.slug, funnel_slug: funnel.slug, sales_funnel_id: funnel.id }
  const pinContext = { ...context, client_id: client.id as string }
  const applyContext = { sales_funnel_id: funnel.id, path: `${base}/regras` }

  function frontLabel(frontId: string): { text: string; own: boolean } {
    const front = frontById.get(frontId)
    if (!front) return { text: '?', own: false }
    const own = front.sales_funnel_id === funnel!.id
    const text = own ? front.code : `${front.sales_funnels?.name ?? 'outro projeto'} · ${front.code}`
    return { text: front.archived_at ? `${text} (arquivada)` : text, own }
  }

  return (
    <div className="flex max-w-[1180px] flex-col gap-8 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Regras de campanha"
        note="Cada campanha tem um dono só: uma frente. O nome sugere o dono (contém todos os textos verdes e nenhum dos vermelhos) e o sync fixa essa escolha, então renomear a campanha no Gerenciador não muda o histórico. Mudar uma regra vale daqui pra frente: campanhas que já gastaram ficam com o dono que têm. Você pode fixar o dono à mão na tabela. Uma frente também pode ler outro projeto, só dentro da janela deste."
        actions={
          <div className="flex items-center gap-1 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-[3px]" role="group" aria-label="Período">
              {PERIODS.map((period) => (
                <Link
                  key={period.value}
                  href={`${base}/regras?periodo=${period.value}`}
                  aria-current={periodo === period.value ? 'page' : undefined}
                  className={`rounded-[7px] px-3 py-1 text-[12.5px] font-medium ${
                    periodo === period.value ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-3)]'
                  }`}
                >
                  {period.label}
                </Link>
              ))}
          </div>
        }
      />

      {ok && (
        <p role="status" className="rounded-[10px] bg-[var(--ct-an-soft)] px-4 py-3 text-[13px] text-[var(--ct-an)]">
          {ok}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {erro}
        </p>
      )}

      {canEdit && mudou && (
        <ApplySincePanel
          previewAction={previewApplySince.bind(null, applyContext)}
          applyAction={applySince.bind(null, applyContext)}
          today={saoPauloDay()}
          fieldClass={fieldClass}
        />
      )}

      <div className="grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {[
          { label: 'Gasto do projeto', value: currency(projectSpend), foot: `campanhas nas frentes · ${periodo === '7d' ? '7' : '30'} dias` },
          { label: 'Frentes', value: String(fronts.length), foot: 'deste projeto' },
          { label: 'Não classificado', value: currency(unclassifiedSpend), foot: 'sem dono · aparece em todos os totais' },
          {
            label: 'Última leitura',
            value: lastSync?.synced_at
              ? new Date(lastSync.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : 'nunca',
            foot: 'campanhas do LaunchOps',
          },
        ].map((kpi) => (
          <div key={kpi.label} className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-[22px] py-5">
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.label}</span>
            <span className={`${mono} text-2xl font-medium tracking-[-0.04em]`}>{kpi.value}</span>
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.foot}</span>
          </div>
        ))}
      </div>

      {campaigns.length > 0 && (() => {
        const check = reconcileSpend(campaigns)
        const balanced = check.doubleCounted < 0.01
        return (
          <div
            role={balanced ? 'status' : 'alert'}
            className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[14px] px-5 py-4 text-[13px] ${
              balanced ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'
            }`}
          >
            <b className="font-semibold">{balanced ? 'Conferência ok' : 'Conferência não fecha'}</b>
            <span className={mono}>
              gasto do Meta {currency(check.total)} = frentes {currency(check.classified)} + não classificado {currency(check.unclassified)}
            </span>
            {!balanced && (
              <span>
                {currency(check.doubleCounted)} contados duas vezes: campanha com mais de um dono. Fixe o dono na tabela abaixo.
              </span>
            )}
          </div>
        )
      })()}

      {campaigns.length === 0 && (
        <p className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-6 text-sm text-[var(--ct-text-2)]">
          Nenhuma campanha com gasto chegou do LaunchOps neste período. Use “Atualizar agora” no projeto para fazer a
          primeira leitura — ela traz os últimos 60 dias.
        </p>
      )}

      {(conflicts.length > 0 || orphans.length > 0) && (
        <div className="flex flex-col gap-3">
          {conflicts.length > 0 && (
            <div className="rounded-[12px] bg-[var(--ct-crit-soft)] px-5 py-4 text-[13px] text-[var(--ct-text-2)]">
              <b className="block text-[var(--ct-crit)]">
                {conflicts.length} {conflicts.length === 1 ? 'campanha está' : 'campanhas estão'} em mais de uma frente
              </b>
              O nome bate com mais de uma frente, então nenhuma conta o gasto até alguém escolher. Fixe o dono na tabela
              abaixo ou ajuste as regras.
              <ul className="mt-2 flex flex-col gap-1">
                {conflicts.slice(0, 8).map((campaign) => (
                  <li key={campaign.campaign_id} className={`${mono} text-[12px]`}>
                    {campaign.campaign_name} → {campaign.suggested_front_ids.map((id) => frontLabel(id).text).join(' ou ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {orphans.length > 0 && (
            <div className="rounded-[12px] bg-[var(--ct-warn-soft)] px-5 py-4 text-[13px] text-[var(--ct-text-2)]">
              <b className="block text-[var(--ct-warn)]">
                {orphans.length} campanhas com gasto e sem frente somam {currency(orphanSpend)}
              </b>
              Elas aparecem como Não classificado em todos os totais, até ganharem uma regra ou um dono fixado. As maiores:
              <ul className="mt-2 flex flex-col gap-1">
                {orphans.slice(0, 6).map((campaign) => (
                  <li key={campaign.campaign_id} className={`${mono} text-[12px]`}>
                    {currency(Number(campaign.spend))} · {campaign.campaign_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[16px] font-semibold">Frentes</h2>
          {!canEdit && <span className="text-xs text-[var(--ct-text-3)]">somente leitura</span>}
        </div>
        {fronts.length === 0 && (
          <p className="text-sm text-[var(--ct-text-3)]">
            Este projeto ainda não tem frentes. Crie a primeira abaixo — por exemplo GRA-GER (Captação Gratuita), PAG
            (Captação Paga) ou PRE (Pré-lançamento).
          </p>
        )}
        {fronts.map((front) => {
          const stats = summary.get(front.id) ?? { campaigns: 0, spend: 0, leads: 0 }
          const frontContext = { ...context, front_id: front.id }
          const includes = front.naming_rules.filter((rule) => rule.kind === 'include')
          const sourceName = front.source_sales_funnel_id ? funnelNameById.get(front.source_sales_funnel_id) ?? 'outro projeto' : null
          return (
            <div key={front.id} className="relative flex flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-[15px] font-semibold">{front.name}</b>
                <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]`}>{front.code}</span>
                <span className={`${mono} ml-auto text-[12px] text-[var(--ct-text-3)]`}>
                  {stats.campaigns} campanhas · {currency(stats.spend)}
                  {stats.leads > 0 ? ` · ${stats.leads.toLocaleString('pt-BR')} leads` : ''}
                </span>
                {canEdit && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[12.5px] font-medium text-[var(--ct-accent)] hover:underline">Editar</summary>
                    <form
                      action={updateFront.bind(null, frontContext)}
                      className="absolute right-6 z-10 mt-2 flex flex-wrap items-end gap-2 rounded-[12px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] p-4 shadow-lg"
                    >
                      <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
                        Código
                        <input name="code" required defaultValue={front.code} className={`${fieldClass} ${mono} w-32`} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
                        Nome
                        <input name="name" required defaultValue={front.name} className={`${fieldClass} w-64`} />
                      </label>
                      {(['principal', 'secundaria'] as const).map((role) => (
                        <div key={role} className="flex basis-full flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
                            Métrica {role === 'principal' ? 'principal' : 'secundária'} da frente
                            <select name={`metrica_${role}`} defaultValue={front[`metrica_${role}`] ?? ''} className={`${fieldClass} w-48`}>
                              <option value="">segue o projeto</option>
                              {(Object.keys(PROJECT_RESULTS) as ProjectResult[]).map((metric) => (
                                <option key={metric} value={metric}>
                                  {PROJECT_RESULTS[metric].cost}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
                            Alvo
                            <input name={`alvo_${role}`} inputMode="decimal" defaultValue={front[`alvo_${role}`] !== null ? String(front[`alvo_${role}`]).replace('.', ',') : ''} className={`${fieldClass} ${mono} w-28`} />
                          </label>
                        </div>
                      ))}
                      <p className="basis-full text-[11.5px] text-[var(--ct-text-3)]">Com métrica e alvo, a frente ganha um vigia próprio. Vazio: segue o projeto, sem alerta próprio.</p>
                      <button type="submit" className="rounded-[8px] bg-[var(--ct-accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
                        Salvar
                      </button>
                    </form>
                  </details>
                )}
                {canEdit && (
                  <ConfirmDeleteButton
                    action={setFrontArchived.bind(null, { ...frontContext, code: front.code }, true)}
                    label="Arquivar"
                    warning="Arquivar? As campanhas dela ficam no histórico, novas não entram."
                  />
                )}
              </div>
              <p className="text-[12.5px] text-[var(--ct-text-2)]">
                {front.metrica_principal
                  ? `Métricas próprias: ${[
                      [front.metrica_principal, front.alvo_principal],
                      [front.metrica_secundaria, front.alvo_secundaria],
                    ]
                      .filter((pair): pair is [ProjectResult, number | null] => pair[0] !== null)
                      .map(([metric, target]) => `${PROJECT_RESULTS[metric].cost}${target !== null ? ` alvo ${Number(target).toLocaleString('pt-BR')}` : ''}`)
                      .join(' · ')}`
                  : 'Segue as métricas do projeto, sem alerta próprio.'}
              </p>
              {sourceName && (
                <p className="text-[12.5px] text-[var(--ct-text-2)]">
                  Lê as campanhas do projeto <b>{sourceName}</b>, só nos dias dentro da janela deste projeto. Não tem
                  regras próprias: as campanhas continuam com um dono só.
                </p>
              )}
              {!sourceName && (
              <div className="flex flex-wrap items-center gap-1.5">
                {front.naming_rules.map((rule) => (
                  <span
                    key={rule.id}
                    className={`${mono} flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ${
                      rule.kind === 'include' ? 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'
                    }`}
                  >
                    {rule.kind === 'include' ? 'contém' : 'não contém'} {rule.value}
                    {canEdit && (
                      <form action={removeRule.bind(null, { ...context, rule_id: rule.id })}>
                        <button type="submit" aria-label={`Remover regra ${rule.value}`} className="opacity-60 hover:opacity-100">
                          ×
                        </button>
                      </form>
                    )}
                  </span>
                ))}
                {includes.length === 0 && (
                  <span className="text-[12px] text-[var(--ct-text-3)]">sem “contém”, esta frente não pega nenhuma campanha</span>
                )}
              </div>
              )}
              {canEdit && !sourceName && (
                <RuleForm addAction={addRule.bind(null, frontContext)} previewAction={previewRule.bind(null, frontContext)} fieldClass={fieldClass} mono={mono} />
              )}
            </div>
          )
        })}
        {canEdit && (
          <form
            action={createFront.bind(null, context)}
            className="flex flex-wrap items-end gap-2 rounded-[14px] border border-dashed border-[var(--ct-line-2)] px-6 py-5"
          >
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Código
              <input name="code" required placeholder="GRA-GER" className={`${fieldClass} ${mono} w-32`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Nome
              <input name="name" required placeholder="Captação Gratuita" className={`${fieldClass} w-64`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Campanhas
              <select name="source_sales_funnel_id" defaultValue="" className={fieldClass}>
                <option value="">próprias, pelas regras de nome</option>
                {(otherFunnels ?? []).filter((other) => !other.archived_at).map((other) => (
                  <option key={other.id} value={other.id}>
                    lê o projeto {other.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-[8px] bg-[var(--ct-accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
              + Nova frente
            </button>
          </form>
        )}
        {archivedFronts.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
              Frentes arquivadas ({archivedFronts.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {archivedFronts.map((front) => (
                <li key={front.id} className="flex items-center gap-3 text-[12.5px] text-[var(--ct-text-2)]">
                  <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px]`}>{front.code}</span>
                  {front.name}
                  {canEdit && (
                    <form action={setFrontArchived.bind(null, { ...context, front_id: front.id, code: front.code }, false)}>
                      <button type="submit" className="text-xs font-semibold text-[var(--ct-accent)] hover:underline">
                        Restaurar
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {tags.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold">Etiquetas encontradas nos nomes</h2>
          <p className="text-[12.5px] text-[var(--ct-text-3)]">
            As etiquetas entre colchetes das campanhas com gasto no período, da que carrega mais verba para a que carrega
            menos. Bons pontos de partida para as regras.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag.tag} className={`${mono} rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2.5 py-1 text-[11.5px] text-[var(--ct-text-2)]`}>
                {tag.tag} <span className="text-[var(--ct-text-3)]">· {currency(tag.spend)} · {tag.campaigns}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {campaigns.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold">Campanhas com gasto ({campaigns.length})</h2>
          <div className="overflow-x-auto rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
                  <th className="px-5 py-3 font-medium">Campanha</th>
                  <th className="px-5 py-3 font-medium">Frente</th>
                  <th className="px-5 py-3 font-medium">Dono</th>
                  <th className="px-5 py-3 text-right font-medium">Gasto</th>
                  <th className="px-5 py-3 text-right font-medium">Leads</th>
                  <th className="px-5 py-3 text-right font-medium">Último dia</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.campaign_id} className="border-t border-[var(--ct-line)]">
                    <td className={`${mono} max-w-[560px] px-5 py-2.5 text-[12px] text-[var(--ct-text-2)]`}>{campaign.campaign_name}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {campaign.front_ids.length === 0 && (
                          <span className="text-[11.5px] text-[var(--ct-warn)]">
                            {campaign.suggested_front_ids.length > 1 ? 'em conflito' : 'não classificado'}
                          </span>
                        )}
                        {campaign.front_ids.map((id) => {
                          const label = frontLabel(id)
                          return (
                            <span
                              key={id}
                              className={`${mono} rounded-full px-2 py-0.5 text-[11px] ${
                                label.own
                                    ? 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]'
                                    : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]'
                              }`}
                            >
                              {label.text}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-[var(--ct-text-3)]">
                          {campaign.assignment ? ASSIGNMENT_LABEL[campaign.assignment] : 'sem dono'}
                        </span>
                        {canEdit && (
                          <form action={pinCampaign.bind(null, pinContext)} className="flex items-center gap-1">
                            <input type="hidden" name="campaign_id" value={campaign.campaign_id} />
                            <select name="front_id" defaultValue={campaign.front_ids[0] ?? ''} aria-label={`Dono de ${campaign.campaign_name}`} className={`${fieldClass} py-1 text-[11.5px]`}>
                              <option value="" disabled>escolher</option>
                              {ownerFronts.map((front) => (
                                <option key={front.id} value={front.id}>
                                  {frontLabel(front.id).text}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="text-[11.5px] font-medium text-[var(--ct-accent)] hover:underline">
                              fixar
                            </button>
                          </form>
                        )}
                        {canEdit && campaign.assignment === 'manual' && (
                          <form action={unpinCampaign.bind(null, { ...pinContext, campaign_id: campaign.campaign_id })}>
                            <button type="submit" className="text-[11.5px] text-[var(--ct-text-3)] hover:underline">
                              soltar
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                    <td className={`${mono} px-5 py-2.5 text-right`}>{currency(Number(campaign.spend))}</td>
                    <td className={`${mono} px-5 py-2.5 text-right`}>{Number(campaign.leads).toLocaleString('pt-BR')}</td>
                    <td className={`${mono} px-5 py-2.5 text-right text-[var(--ct-text-3)]`}>
                      {campaign.last_day.slice(8, 10)}/{campaign.last_day.slice(5, 7)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
