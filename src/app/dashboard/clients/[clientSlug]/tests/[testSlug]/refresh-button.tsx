'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="flex h-9 items-center gap-1.5 rounded-[9px] border border-[var(--ct-ok)] bg-[var(--ct-ok)] px-4 text-[13px] font-medium text-[var(--ct-on-accent)] disabled:opacity-60"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        className={isPending ? 'animate-spin' : ''}
      >
        <path
          d="M13.65 2.35A7.958 7.958 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8a7.98 7.98 0 0 0 7.6-5.5h-2.1A5.98 5.98 0 0 1 8 14c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.68 4.22 1.78L9 7h7V0l-2.35 2.35Z"
          fill="currentColor"
        />
      </svg>
      {isPending ? 'Atualizando...' : 'Atualizar'}
    </button>
  )
}
