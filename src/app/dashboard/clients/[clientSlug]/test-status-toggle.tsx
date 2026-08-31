'use client'

import { useTransition } from 'react'
import { toggleTestStatus } from './actions'

export function TestStatusToggle({
  testId,
  clientSlug,
  status,
}: {
  testId: string
  clientSlug: string
  status: 'active' | 'paused'
}) {
  const [isPending, startTransition] = useTransition()
  const isActive = status === 'active'

  function handleToggle() {
    startTransition(async () => {
      await toggleTestStatus({
        test_id: testId,
        next_status: isActive ? 'paused' : 'active',
        client_slug: clientSlug,
      })
    })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={isActive}
      aria-label={isActive ? 'Pausar teste' : 'Ativar teste'}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-60 ${
        isActive ? 'bg-[#2DD4A8]' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          isActive ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
