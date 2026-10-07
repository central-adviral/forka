'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CommandItem {
  label: string
  /** Shown on the right: what kind of place this is (cliente, projeto, tela). */
  group: string
  href: string
}

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ⌘K / Ctrl+K: jump to any client, project or screen by typing part of its name.
export function CommandPalette({ items }: { items: CommandItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuery('')
        setCursor(0)
        setOpen((value) => !value)
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => {
    const needle = plain(query).trim()
    return (needle ? items.filter((item) => plain(`${item.label} ${item.group}`).includes(needle)) : items).slice(0, 12)
  }, [items, query])

  function go(item: CommandItem | undefined) {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery('')
          setCursor(0)
          setOpen(true)
        }}
        className="flex items-center gap-2 rounded-full border border-[var(--ct-line)] px-3 py-1 text-[12px] text-[var(--ct-text-3)] hover:text-[var(--ct-text)]"
        aria-label="Buscar cliente, projeto ou tela"
      >
        Buscar
        <kbd className="font-[family-name:var(--font-geist-mono)] text-[10.5px]">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Buscar"
            className="w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-[var(--ct-line-2)] bg-[var(--ct-surface)] shadow-[var(--ct-shadow)]"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor((value) => Math.min(value + 1, results.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor((value) => Math.max(value - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  go(results[cursor])
                }
              }}
              placeholder="Cliente, projeto ou tela…"
              aria-label="Buscar cliente, projeto ou tela"
              className="w-full border-b border-[var(--ct-line)] bg-transparent px-5 py-4 text-[15px] text-[var(--ct-text)] outline-none"
            />
            <ul role="listbox" className="max-h-[360px] overflow-y-auto py-2">
              {results.length === 0 && <li className="px-5 py-3 text-[13px] text-[var(--ct-text-3)]">Nada encontrado.</li>}
              {results.map((item, index) => (
                <li key={`${item.group}-${item.href}`} role="option" aria-selected={index === cursor}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(item)}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-2.5 text-left text-[13.5px] ${
                      index === cursor ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)]'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="flex-none text-[11px] uppercase tracking-wide text-[var(--ct-text-3)]">{item.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
