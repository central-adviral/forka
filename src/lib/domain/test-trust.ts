import { DEFAULT_RULES, type TestRules } from './backlog'
import { requiredVisitsPerArm } from './backlog-readout'
import type { SrmStatus } from './srm-check'

// The "can I trust this read?" seal of the A/B report. Same bar as the backlog verdict: the sample
// the control's rate calls for on every live side, plus a full week so weekday swings even out.

export const MIN_CYCLE_DAYS = 7

export interface TrustArm {
  isControl: boolean
  weightPct: number
  visits: number
  conversions: number
}

export interface ReportTrust {
  trustworthy: boolean
  /** Only a skewed draw makes the number wrong; every other state is just early. */
  strikeConfidence: boolean
  badge: string
  instruction: string
  explain: string
  /** People each live side needs; null while the control has no conversion to size it from. */
  needed: number | null
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

export function reportTrust(srm: SrmStatus, arms: TrustArm[], daysRunning: number, rules: TestRules = DEFAULT_RULES): ReportTrust {
  const control = arms.find((arm) => arm.isControl) ?? arms[0]
  const controlRate = control && control.visits > 0 ? control.conversions / control.visits : 0
  const sample = requiredVisitsPerArm(controlRate, rules.conf, rules.mde)
  const needed = sample === null ? null : Math.max(rules.minVisits, sample)
  const early = (badge: string, explain: string): ReportTrust => ({
    trustworthy: false,
    strikeConfidence: false,
    badge,
    instruction: 'mantenha o teste rodando',
    explain,
    needed,
  })

  if (srm === 'mismatch') {
    return {
      trustworthy: false,
      strikeConfidence: true,
      badge: '⚠ sorteio fora do peso',
      instruction: 'investigue antes de decidir',
      explain:
        'SRM: a proporção real de visitas por variante está estatisticamente diferente do peso configurado. Pode ser bot, cache ou bug no sorteio. Esperar mais tráfego não corrige, só acumula dado contaminado.',
      needed,
    }
  }
  if (srm === 'single_variant') {
    return { ...early('◷ só 1 variante no sorteio', 'Só uma variante tem peso acima de 0, então não há o que comparar nem sorteio para conferir.'), instruction: 'ajuste os pesos para comparar' }
  }
  if (srm === 'too_many') {
    return early('◷ sorteio não conferido', 'Com mais de 10 variantes o sorteio não é conferido, e cada uma precisa de amostra própria. Junte variantes ou rode em etapas.')
  }
  if (srm === 'no_data') {
    return early('◷ ainda sem volume', 'Menos de 100 visitas: ainda não dá para checar se o sorteio respeita os pesos, nem para confiar na chance. Não é erro, é cedo.')
  }

  const liveArms = arms.filter((arm) => arm.weightPct > 0)
  const smallest = liveArms.reduce((min, arm) => Math.min(min, arm.visits), Infinity)
  const missingDays = Math.max(0, MIN_CYCLE_DAYS - daysRunning)
  if (needed === null) {
    return early('◷ amostra insuficiente', 'O controle ainda não tem conversão, então não dá para calcular a amostra mínima. A chance mostrada agora é muito sorte.')
  }
  if (smallest < needed || missingDays > 0) {
    const missing = [
      smallest < needed && `${fmt(needed)} pessoas em cada variante (a menor tem ${fmt(smallest)})`,
      missingDays > 0 && `${missingDays} ${missingDays === 1 ? 'dia' : 'dias'} para fechar a semana`,
    ].filter(Boolean)
    return early(
      '◷ amostra insuficiente',
      `O sorteio está no peso, mas falta ${missing.join(' e ')}. A amostra vem da conversão do controle e da melhora mínima de ${rules.mde}%, com ${rules.conf}% de confiança: antes disso a chance oscila e aponta falsos vencedores.`
    )
  }
  return {
    trustworthy: true,
    strikeConfidence: false,
    badge: '✓ dados confiáveis',
    instruction: 'confiança estatística',
    explain: `Tráfego na proporção configurada, ${fmt(needed)}+ pessoas em cada variante e ${daysRunning} dias rodando: a leitura de chance se sustenta.`,
    needed,
  }
}
