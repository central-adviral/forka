'use client'

import { useState } from 'react'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — fail silently,
      // the text is still visible on screen for the user to select manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copiar"
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-[#A1A1AA] hover:text-[#EDEDF0]"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="#4ADE9B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 9.5V2.8C2 2.36 2.36 2 2.8 2H9.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )}
    </button>
  )
}
