import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import { daysRunningSince } from '@/lib/domain/report-period'

// "O que testamos": the story of the tests, for the client and as the team's library of learnings.
// The client reads only what was published (0068 RLS: running or decided and published); the team
// reads the same view by default, and every decision with "todos", to search what is already known.

const mono = 'font-[family-name:var(--font-geist-mono)]'
const PERIODS = [
  { value: 'mes', label: 'Este mês', days: 31 },
  { value: 'trimestre', label: 'Trimestre', days: 92 },
  { value: 'tudo', label: 'Tudo', days: null },
] as const

/** The start of the period, as an ISO date; null for all of it. */
function periodStart(days: number | null): string | null {
  return days ? new Date(Date.now() - days * 86_400_000).toISOString() : null
}

interface Story {
  id: string
  code: string
  title: string
  hypothesis: string
  status: 'running' | 'decided'
  result: string | null
  learning: string | null
  winner_key: string | null
  published: boolean
  started_at: string | null
  decided_at: string | null
  sales_funnels: { name: string } | null
  backlog_variants: { key: string; name: string }[]
}

export default async function LearningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ periodo?: string; q?: string; todos?: string }>
}) {
  const { clientSlug } = await params
  const { periodo, q, todos } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const isTeam = await canActAs(supabase, client.id, 'analista')
  const showAll = isTeam && todos === '1'
  const period = PERIODS.find((option) => option.value === periodo) ?? PERIODS[0]
  const since = periodStart(period.days)

  let query = supabase
    .from('backlog_items')
    .select('id, code, title, hypothesis, status, result, learning, winner_key, published, started_at, decided_at, sales_funnels(name), backlog_variants(key, name)')
    .eq('client_id', client.id)
    .in('status', showAll ? ['decided'] : ['running', 'decided'])
    .order('decided_at', { ascending: false, nullsFirst: true })
  if (!showAll) query = query.eq('published', true)
  const { data, error } = await query
  if (error) console.error('[learnings-read-failed]', { clientId: client.id }, error)

  const term = (q ?? '').trim().toLowerCase()
  const stories = ((data ?? []) as unknown as Story[]).filter((story) => {
    if (story.status === 'decided' && since && (!story.decided_at || story.decided_at < since)) return false
    if (!term) return true
    return [story.title, story.hypothesis, story.learning ?? '', story.result ?? ''].some((text) => text.toLowerCase().includes(term))
  })
  const decided = stories.filter((story) => story.status === 'decided')
  const applied = decided.filter((story) => story.winner_key)
  const running = stories.filter((story) => story.status === 'running')
  const base = `/dashboard/clients/${client.slug}/aprendizados`
  const link = (extra: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    const merged = { periodo: period.value, q: q || undefined, todos: showAll ? '1' : undefined, ...extra }
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value)
    return `${base}?${next}`
  }

  return (
    <div className="flex max-w-[1100px] flex-col gap-6 px-4 pb-24 pt-12 md:px-14">
      <PageHeader
        note={`${client.name} · ${
          showAll
            ? 'Todos os testes decididos, publicados ou não. Busque antes de criar uma hipótese: talvez já se saiba a resposta.'
            : 'O que testamos, o que ganhou e o que aprendemos. Só aparece o que foi publicado para o cliente.'
        }`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((option) => (
          <Link
            key={option.value}
            href={link({ periodo: option.value })}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${option.value === period.value ? 'border-[var(--ct-accent)] text-[var(--ct-accent)]' : 'border-[var(--ct-line)] text-[var(--ct-text-2)]'}`}
          >
            {option.label}
          </Link>
        ))}
        <form action={base} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="periodo" value={period.value} />
          {showAll && <input type="hidden" name="todos" value="1" />}
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar: preço, garantia, quiz…"
            className="w-[220px] rounded-full border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ct-accent)]"
          />
        </form>
        {isTeam && (
          <Link href={link({ todos: showAll ? undefined : '1' })} className="text-[12.5px] text-[var(--ct-accent)]">
            {showAll ? 'Ver como o cliente vê' : 'Ver todos os aprendizados'}
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [decided.length, `${decided.length === 1 ? 'teste decidido' : 'testes decididos'} · ${period.label.toLowerCase()}`],
          [applied.length, applied.length === 1 ? 'melhoria com vencedora' : 'melhorias com vencedora'],
          [running.length, running.length === 1 ? 'teste rodando agora' : 'testes rodando agora'],
        ].map(([value, label]) => (
          <div key={String(label)} className="rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
            <b className={`${mono} text-[26px]`}>{value}</b>
            <p className="text-[12.5px] text-[var(--ct-text-2)]">{label}</p>
          </div>
        ))}
      </div>

      {stories.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[var(--ct-line-2)] px-5 py-8 text-center text-[13px] text-[var(--ct-text-3)]">
          {term ? 'Nenhum teste com essa busca.' : showAll ? 'Nenhum teste decidido no período.' : 'Nenhum teste publicado no período.'}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {[...running, ...decided].map((story) => {
          const winner = story.backlog_variants.find((variant) => variant.key === story.winner_key)
          const tone = story.status === 'running' ? 'var(--ct-ab)' : story.winner_key ? 'var(--ct-ok)' : 'var(--ct-text-3)'
          return (
            <article key={story.id} className="grid grid-cols-[4px_minmax(0,1fr)] gap-4 rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] py-4 pr-5">
              <span className="rounded-r-[4px]" style={{ background: tone }} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`${mono} text-[11px] text-[var(--ct-text-3)]`}>
                    {story.code}
                    {story.sales_funnels ? ` · ${story.sales_funnels.name}` : ''}
                  </span>
                  {isTeam && !story.published && <span className="rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-3)]">não publicado</span>}
                  <span className="ml-auto text-[12px] font-semibold" style={{ color: tone }}>
                    {story.status === 'running'
                      ? `rodando · dia ${story.started_at ? daysRunningSince(story.started_at) : 1}`
                      : winner
                        ? `venceu ${winner.key} · ${winner.name}`
                        : 'sem vencedora'}
                  </span>
                </div>
                <h2 className="text-[16px] font-semibold">{story.title}</h2>
                {story.hypothesis && <p className="text-[13px] leading-relaxed text-[var(--ct-text-2)]">{story.hypothesis}</p>}
                {story.result && <p className="text-[13px] text-[var(--ct-text)]">Resultado: {story.result}</p>}
                {story.learning && (
                  <p className="rounded-[10px] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px]">
                    <span className={`${mono} mr-2 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-accent)]`}>Aprendizado</span>
                    {story.learning}
                  </p>
                )}
                {story.status === 'running' && <p className="text-[12.5px] text-[var(--ct-text-3)]">Em andamento: o resultado aparece aqui quando o teste for decidido.</p>}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
