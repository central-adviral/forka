// Shown inside the shell while a dashboard page loads its data, so a click never looks frozen.
export default function DashboardLoading() {
  return (
    <div className="flex max-w-[1320px] flex-col gap-8 px-14 pb-24 pt-12" role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--ct-surface-2)]" />
        <div className="h-8 w-72 animate-pulse rounded-lg bg-[var(--ct-surface-2)]" />
      </div>
      <div className="grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]" />
    </div>
  )
}
