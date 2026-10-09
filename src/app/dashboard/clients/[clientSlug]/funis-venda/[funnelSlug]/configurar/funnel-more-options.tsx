import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { saveLegacyOperations, setSalesFunnelArchived } from '../../actions'

const field =
  'w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]'

// What the old "Editar funil" had beyond the header (0107): the old LaunchOps operations and archiving.
export function FunnelMoreOptions({
  context,
  operacaoIds,
}: {
  context: { sales_funnel_id: string; client_id: string; client_slug: string; funnel_slug: string }
  operacaoIds: string
}) {
  return (
    <details className="rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-3.5" open={operacaoIds !== '' || undefined}>
      <summary className="cursor-pointer text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">Outras opções do funil</summary>
      <div className="mt-3 flex flex-col gap-5">
        <form action={saveLegacyOperations.bind(null, context)} className="flex max-w-xl flex-col gap-2">
          <label className="text-xs text-[var(--ct-text-2)]" htmlFor="launchops_operacao_ids">
            Histórico antigo · IDs de operação do LaunchOps (separados por vírgula)
          </label>
          <input id="launchops_operacao_ids" name="launchops_operacao_ids" defaultValue={operacaoIds} className={field} />
          <p className="text-xs text-[var(--ct-text-2)]">
            Só para funis com dias anteriores às campanhas sincronizadas. Com frentes, o gasto vem das campanhas pela etiqueta.
          </p>
          <button type="submit" className="self-start rounded-full border border-[var(--ct-line-2)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ct-text)] hover:bg-[var(--ct-surface-2)]">
            Salvar histórico antigo
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ct-line)] pt-4 text-[12.5px] text-[var(--ct-text-2)]">
          <span>Arquivar tira o funil das listas; os números ficam e vendas novas não entram. Dá para restaurar depois.</span>
          <ConfirmDeleteButton
            action={setSalesFunnelArchived.bind(null, context.sales_funnel_id, true)}
            label="Arquivar funil"
            warning="Arquivar? Os números ficam, vendas novas não entram."
          />
        </div>
      </div>
    </details>
  )
}
