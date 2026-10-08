'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Lane } from '@/lib/domain/board'

export interface BoardCard {
  id: string
  code: string
  title: string
  href: string
  selected: boolean
  methodColor: string
  methodLabel: string
  ice: string
  meta: string
  status: { text: string; tone: string }
  pill: { text: string; tone: string } | null
  progress: { done: number; target: number; label: string } | null
}

export interface BoardLane {
  lane: Lane
  label: string
  hint: string
  cards: BoardCard[]
  footer?: { text: string; href: string }
}

const mono = 'font-[family-name:var(--font-geist-mono)]'

// Lanes a card can be dropped on. "Pede decisão" is where the rules put a card, not a place to put
// it; a drop on Decidido opens the decision, because a decision needs its learning.
const DROPPABLE: Lane[] = ['queue', 'ready', 'running', 'decided']

export function Board({ lanes, move }: { lanes: BoardLane[]; move: ((itemId: string, code: string, to: 'queue' | 'ready' | 'running') => Promise<void>) | null }) {
  const router = useRouter()
  const [dragged, setDragged] = useState<{ id: string; code: string; href: string } | null>(null)
  const [over, setOver] = useState<Lane | null>(null)
  const [pending, startTransition] = useTransition()

  function drop(lane: Lane) {
    setOver(null)
    if (!dragged || !move) return
    const card = dragged
    setDragged(null)
    if (lane === 'decided') {
      router.push(`${card.href}#decidir`)
      return
    }
    if (lane === 'decide') return
    startTransition(() => move(card.id, card.code, lane))
  }

  return (
    <div className={`grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(5,minmax(210px,1fr))] ${pending ? 'opacity-70' : ''}`} aria-busy={pending}>
      {lanes.map((column) => {
        const droppable = Boolean(move) && DROPPABLE.includes(column.lane)
        return (
          <div
            key={column.lane}
            onDragOver={(event) => {
              if (!droppable || !dragged) return
              event.preventDefault()
              setOver(column.lane)
            }}
            onDragLeave={() => setOver((current) => (current === column.lane ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              drop(column.lane)
            }}
            className={`flex min-h-[240px] flex-col gap-2 rounded-[14px] border p-2 transition-colors ${
              over === column.lane
                ? 'border-[var(--ct-accent)] bg-[var(--ct-accent-soft)]'
                : column.lane === 'decide' && column.cards.length > 0
                  ? 'border-[var(--ct-warn)]/50 bg-[var(--ct-surface-2)]'
                  : 'border-transparent bg-[var(--ct-surface-2)]'
            }`}
          >
            <div className="flex items-baseline gap-2 px-1.5 pt-1">
              <b className="text-[12.5px]">{column.label}</b>
              <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>{column.cards.length}</span>
            </div>
            <span className="-mt-1 px-1.5 text-[11px] text-[var(--ct-text-3)]">{column.hint}</span>
            {column.cards.length === 0 && (
              <div className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-3 text-center text-[12px] text-[var(--ct-text-3)]">vazio</div>
            )}
            {column.cards.map((card) => (
              <Link
                key={card.id}
                href={card.href}
                draggable={Boolean(move)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  setDragged({ id: card.id, code: card.code, href: card.href })
                }}
                onDragEnd={() => {
                  setDragged(null)
                  setOver(null)
                }}
                aria-current={card.selected ? 'true' : undefined}
                className={`flex flex-col gap-1.5 rounded-[14px] border bg-[var(--ct-surface)] px-3 py-3 ${move ? 'cursor-grab active:cursor-grabbing' : ''} ${
                  dragged?.id === card.id ? 'opacity-45' : ''
                } ${card.selected ? 'border-[var(--ct-accent)]' : 'border-[var(--ct-line)] hover:border-[var(--ct-line-2)]'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`${mono} text-[11px] text-[var(--ct-text-3)]`}>{card.code}</span>
                  <span className="h-[7px] w-[7px] rounded-full" style={{ background: card.methodColor }} title={card.methodLabel} />
                  <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>ICE {card.ice}</span>
                </span>
                <b className="text-[13px] leading-snug">{card.title}</b>
                <span className="text-[11.5px] text-[var(--ct-text-3)]">{card.meta}</span>
                <span className={`text-[11.5px] ${card.status.tone}`}>{card.status.text}</span>
                {card.progress && (
                  <span className="flex flex-col gap-1">
                    <span className="h-[5px] overflow-hidden rounded-full bg-[var(--ct-surface-3)]">
                      <i className="block h-full rounded-full bg-[var(--ct-ab)]" style={{ width: `${Math.min(100, (card.progress.done / Math.max(1, card.progress.target)) * 100)}%` }} />
                    </span>
                    <span className={`${mono} text-[10.5px] text-[var(--ct-text-3)]`}>{card.progress.label}</span>
                  </span>
                )}
                {card.pill && <span className={`rounded-[8px] px-2 py-1 text-[11.5px] font-medium ${card.pill.tone}`}>{card.pill.text}</span>}
              </Link>
            ))}
            {column.footer && (
              <Link href={column.footer.href} className="px-1.5 pt-1 text-[11.5px] text-[var(--ct-accent)]">
                {column.footer.text}
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
