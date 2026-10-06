import { STATUS_LABEL, type WatcherStatus } from '@/lib/domain/watchers'

const STATUS_TONE: Record<WatcherStatus, string> = {
  ok: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]',
  warn: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
  crit: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]',
  sem_volume: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]',
  sem_dado: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]',
}

export function WatcherStatusPill({ status }: { status: WatcherStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
}
