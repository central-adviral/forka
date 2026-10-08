'use client'

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { NavHeading } from '@/lib/nav/nav-config'

/** What the shell knows about the active navigation item, for the page header under it. */
export const NavHeadingContext = createContext<NavHeading | null>(null)

export function useNavHeading(): NavHeading | null {
  return useContext(NavHeadingContext)
}

// Next's <Link> moves between anchors of the same page with history.pushState, which fires no
// hashchange; the nav links announce it with this event so the active subsection follows.
const HASH_EVENT = 'ct-hash'

export function announceHashChange() {
  window.dispatchEvent(new Event(HASH_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  window.addEventListener(HASH_EVENT, onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(HASH_EVENT, onChange)
  }
}

/** The URL's #anchor, kept in sync with in-page navigation. Empty during server render. */
export function useLocationHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => ''
  )
}
