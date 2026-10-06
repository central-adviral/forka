function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} d`
}

export function SyncStatus({ lastRunAt, hasError }: { lastRunAt: string | null; hasError: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-[#A1A1AA]">
      <span className={`pulse-dot ${hasError ? 'pulse-dot--error' : 'pulse-dot--ok'}`} />
      {lastRunAt ? `Sincronizado ${formatRelativeTime(lastRunAt)}` : 'Nunca sincronizou'}
    </div>
  )
}
