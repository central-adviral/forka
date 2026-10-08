// Class strings for page-header actions. Kept out of the client header module so server pages
// import plain strings, not client references.

/** The rounded secondary action the prototype puts in a page header. */
export const headerAction =
  'rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:border-[var(--ct-text-3)] hover:text-[var(--ct-text)]'

/** The page's main action, on the right of the header. */
export const headerPrimaryAction =
  'rounded-[10px] bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110'
