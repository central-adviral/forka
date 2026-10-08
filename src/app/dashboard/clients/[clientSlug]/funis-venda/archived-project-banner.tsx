import { setSalesFunnelArchived } from './actions'

export function ArchivedProjectBanner({
  salesFunnelId,
  archivedAt,
  canRestore,
  note = 'Os números ficam como estavam; vendas novas, sync e vigias não entram mais.',
  className = '',
}: {
  salesFunnelId: string
  archivedAt: string
  canRestore: boolean
  note?: string
  className?: string
}) {
  return (
    <div role="status" className={`flex flex-wrap items-center gap-3 rounded-[12px] bg-[var(--ct-surface-2)] px-5 py-3 text-[13px] text-[var(--ct-text-2)] ${className}`}>
      <span>
        <b className="text-[var(--ct-text)]">
          Projeto arquivado em {new Date(archivedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}.
        </b>{' '}
        {note}
      </span>
      {canRestore && (
        <form action={setSalesFunnelArchived.bind(null, salesFunnelId, false)} className="ml-auto">
          <button type="submit" className="text-[13px] font-semibold text-[var(--ct-accent)] hover:underline">
            Restaurar
          </button>
        </form>
      )}
    </div>
  )
}
