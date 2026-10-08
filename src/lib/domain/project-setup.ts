// The five steps that make a project's numbers trustworthy, in the order each one uses the previous.
// Built only from facts the Central already stores; nothing here writes.

export type SetupStepId = 'integracoes' | 'produtos' | 'regras' | 'plano' | 'metas'

export interface SetupFacts {
  /** LaunchOps source URL and its key are set for the client. */
  launchopsConnected: boolean
  /** The Hubla webhook token is set for the client. */
  hublaConnected: boolean
  /** Products of the project with the entry role. */
  entryProducts: number
  /** Naming rules across the project's fronts. */
  namingRules: number
  /** The project's result (compra or lead) and its cost target (the project-wide cost watcher). */
  resultado: string | null
  costTarget: number | null
  /** Watchers of the project other than the project-wide cost one. */
  extraWatchers: number
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
  const steps: SetupStep[] = [
    {
      id: 'integracoes',
      label: 'Integrações',
      done: integrations,
      text: integrations ? 'LaunchOps e Hubla conectados.' : `Falta conectar ${missingSources}.`,
    },
    {
      id: 'produtos',
      label: 'Produtos',
      done: facts.entryProducts > 0,
      text: facts.entryProducts > 0 ? `${plural(facts.entryProducts, 'produto', 'produtos')} de entrada.` : 'Nenhum produto com papel de entrada: o CPA não tem venda para contar.',
    },
    {
      id: 'regras',
      label: 'Regras de campanha',
      done: facts.namingRules > 0,
      text: facts.namingRules > 0 ? `${plural(facts.namingRules, 'regra', 'regras')} de nome definindo as campanhas do projeto.` : 'Nenhuma regra: o projeto ainda não sabe quais campanhas são dele.',
    },
    {
      id: 'plano',
      label: 'Plano',
      done: plan,
      text: plan ? `Resultado ${facts.resultado} com alvo definido.` : 'Falta o resultado do projeto e o custo-alvo.',
    },
    {
      id: 'metas',
      label: 'Metas',
      done: facts.extraWatchers > 0,
      text: facts.extraWatchers > 0 ? `${plural(facts.extraWatchers, 'vigia', 'vigias')} além do de custo.` : 'Só o vigia de custo: nada avisa quando CTR, CPM ou frequência saem da faixa.',
    },
  ]
  return { steps, done: steps.filter((step) => step.done).length }
}
