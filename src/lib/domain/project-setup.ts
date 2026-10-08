import { PROJECT_RESULTS, readResult, resultUsesSales } from './project-plan'

// The eight steps that make a project's numbers trustworthy, in the order each one uses the previous
// (Arquitetura dos Números, "Como configurar"). Built only from facts the Central already stores.

export type SetupStepId = 'integracoes' | 'projeto' | 'produtos' | 'regras' | 'paginas' | 'plano' | 'metas' | 'conferir'

export interface SetupFacts {
  /** LaunchOps source URL and its key are set for the client. */
  launchopsConnected: boolean
  /** The Hubla webhook token is set for the client. */
  hublaConnected: boolean
  /** Products of the project with the entry role. */
  entryProducts: number
  /** Naming rules across the project's fronts. */
  namingRules: number
  /** Own fronts (not mirrors), and how many of them have at least one "contém" rule. */
  ownFronts: number
  ownFrontsWithInclude: number
  /** Fronts that read another project (they need no rules of their own). */
  mirrorFronts: number
  /** The project's result (compra or lead) and its cost target (the project-wide cost watcher). */
  resultado: string | null
  costTarget: number | null
  /** Watchers of the project other than the project-wide cost one. */
  extraWatchers: number
  /** The project's window; both empty is a perpetual project. */
  startsOn: string | null
  endsOn: string | null
  /** Active pages of the project, and the names of its own fronts with none. */
  activePages: number
  frontsWithoutPage: string[]
  /** What the quality seals still flag on the project (0092). */
  openSeals: string[]
}

export interface SetupStep {
  id: SetupStepId
  label: string
  done: boolean
  /** One line: what is set, or what is missing. */
  text: string
}

export interface SetupStatus {
  steps: SetupStep[]
  done: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function projectSetupStatus(facts: SetupFacts): SetupStatus {
  const integrations = facts.launchopsConnected && facts.hublaConnected
  const missingSources = [!facts.launchopsConnected && 'LaunchOps', !facts.hublaConnected && 'Hubla'].filter(Boolean).join(' e ')
  const plan = facts.resultado !== null && facts.costTarget !== null && facts.costTarget > 0
  // A front with only "não contém" takes no campaign; a mirror front reads another project instead.
  const frontsWithoutInclude = facts.ownFronts - facts.ownFrontsWithInclude
  const rulesDone = facts.ownFronts + facts.mirrorFronts > 0 && frontsWithoutInclude === 0
  const rulesText =
    facts.ownFronts + facts.mirrorFronts === 0
      ? 'Nenhuma frente: o projeto ainda não sabe quais campanhas são dele.'
      : frontsWithoutInclude > 0
        ? `${plural(frontsWithoutInclude, 'frente sem', 'frentes sem')} regra de "contém": não pega nenhuma campanha.`
        : [
            facts.ownFronts > 0 ? `${plural(facts.namingRules, 'regra', 'regras')} de nome definindo as campanhas do projeto` : null,
            facts.mirrorFronts > 0 ? `${plural(facts.mirrorFronts, 'frente lê', 'frentes leem')} outro projeto` : null,
          ]
            .filter(Boolean)
            .join('; ') + '.'
  const objective = PROJECT_RESULTS[readResult(facts.resultado)]
  const day = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')
  const window = facts.startsOn || facts.endsOn ? `${facts.startsOn ? `de ${day(facts.startsOn)}` : ''}${facts.endsOn ? ` até ${day(facts.endsOn)}` : ''}`.trim() : 'sem datas (perpétuo)'
  const pagesDone = facts.ownFronts > 0 && facts.frontsWithoutPage.length === 0
  const steps: SetupStep[] = [
    {
      id: 'integracoes',
      label: 'Integrações',
      done: integrations,
      text: integrations ? 'LaunchOps e Hubla conectados.' : `Falta conectar ${missingSources}.`,
    },
    {
      id: 'projeto',
      label: 'Projeto',
      done: true,
      text: `Objetivo ${objective.label.toLowerCase()} (${objective.cost}), ${window}.`,
    },
    {
      id: 'produtos',
      label: 'Produtos',
      // A lead project's cost is the CPL: it counts leads, not sales, so it needs no entry product.
      done: !resultUsesSales(facts.resultado) || facts.entryProducts > 0,
      text:
        !resultUsesSales(facts.resultado)
          ? `Objetivo ${PROJECT_RESULTS[readResult(facts.resultado)].label.toLowerCase()}: o ${PROJECT_RESULTS[readResult(facts.resultado)].cost} sai das campanhas, sem produto de entrada.`
          : facts.entryProducts > 0
            ? `${plural(facts.entryProducts, 'produto', 'produtos')} de entrada.`
            : 'Nenhum produto com papel de entrada: o CPA não tem venda para contar.',
    },
    {
      id: 'regras',
      label: 'Frentes e regras',
      done: rulesDone,
      text: rulesText,
    },
    {
      id: 'paginas',
      label: 'Páginas',
      done: pagesDone,
      text:
        facts.ownFronts === 0
          ? 'Sem frente própria: as páginas ficam ligadas a uma frente.'
          : facts.frontsWithoutPage.length > 0
            ? `Sem página vigiada: ${facts.frontsWithoutPage.join(', ')}. Se a página cair, ninguém avisa.`
            : `${plural(facts.activePages, 'página vigiada', 'páginas vigiadas')}, toda frente com a sua.`,
    },
    {
      id: 'plano',
      label: 'Plano',
      done: plan,
      text: plan ? `Resultado ${facts.resultado} com alvo definido.` : 'Falta o resultado do projeto e o custo-alvo.',
    },
    {
      id: 'metas',
      label: 'Vigias',
      done: facts.extraWatchers > 0,
      text: facts.extraWatchers > 0 ? `${plural(facts.extraWatchers, 'vigia', 'vigias')} além do de custo.` : 'Só o vigia de custo: nada avisa quando CTR, CPM ou frequência saem da faixa.',
    },
  ]
  const pendingBefore = steps.filter((step) => !step.done).length
  steps.push({
    id: 'conferir',
    label: 'Conferir',
    done: pendingBefore === 0 && facts.openSeals.length === 0,
    text:
      facts.openSeals.length > 0
        ? `Falta resolver: ${facts.openSeals.join('; ')}.`
        : pendingBefore > 0
          ? 'Conclua os passos acima; o mapa abaixo mostra o que entra em cada número.'
          : 'Tudo certo: cada número do projeto mostra de onde vem.',
  })
  return { steps, done: steps.filter((step) => step.done).length }
}
