'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function SuccessBanner({ param, message }: { param: string; message: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (searchParams.get(param) === '1') {
      setVisible(true)
      const timeout = setTimeout(() => {
        setVisible(false)
        router.replace(window.location.pathname)
      }, 3000)
      return () => clearTimeout(timeout)
    }
  }, [searchParams, param, router])

  if (!visible) return null

  return (
    <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-[#2DD4A8]/35 bg-[#2DD4A8]/10 px-3.5 py-2.5 text-sm text-[#2DD4A8]">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {message}
    </div>
  )
}
