# AB Test Tool — Optimization Addendum

> Amends [2026-08-25-ab-test-tool-design.md](2026-08-25-ab-test-tool-design.md). Read both — this
> file only covers what changes or is added; everything else in the original spec still applies.

## Context

Drafted by comparing the tool against market A/B testing tools (VWO, Optimizely, GrowthBook, etc.)
after the original 15-task plan was already fully implemented, reviewed, and fixed. Goal: close
the gaps that comparison surfaced and harden what's already in scope — **without adding cost or
changing the stack** (still Next.js + Vercel + Supabase, all on free tiers) and **without changing
the target user** (still internal, single operator, agency use across multiple clients).

This version reconciles an earlier draft of this addendum (written against a stale copy of the
plan, before several mid-execution bug fixes landed) with the actual, already-implemented and
already-reviewed code — task numbering, migration numbering, and code snippets below match what
really exists in this worktree, not the original draft.

## Additions to scope

1. **Bot/crawler filtering on the redirect route.** User-agent based filtering so known bots
   (search engine crawlers, uptime monitors, social link-preview fetchers) don't get counted as
   visits or assigned a persistent variant, which would silently skew conversion rates. Redirects
   still happen (SEO/preview correctness), just without tracking.
2. **Statistical confidence indicator.** A Bayesian probability ("chance desta variante ser melhor
   que a variante controle") computed from visits/conversions already in the report — pure
   computation, no new dependency, no new service. This is **not** automatic winner declaration:
   the operator still decides when to stop a test. The "no stats significance" line in the original
   spec is narrowed to "no automatic winner declaration," not "no stats at all."
3. **Conversion breakdown by traffic source.** `click_events.source_utms` is already captured per
   the original design; this adds a second report view grouping the same visits/conversions by
   `utm_source` instead of only by variant. No new data collection, just a new read query — built
   consistently with the conversion-method filter already fixed in the main report (a click can
   hold conversions from more than one source across its lifetime; both reports must only count
   the one matching the test's actual `conversion_method`).
4. **Usage awareness widget.** A small counter on the dashboard home page showing total
   `click_events` rows, so the operator has an early informal signal before hitting Supabase
   free-tier limits (500MB DB / 5GB egress). Not an alert system, not a paid monitoring service —
   one query, one number.
5. **Pause/activate a test.** The original plan only ever let a test be created — there was no way
   to stop a losing variant from serving traffic without touching the database directly. A single
   status toggle on the report page, protected by the same RLS ownership policy every other
   dashboard write already relies on.
6. **Auto-generated thank-you pixel snippet.** The `variants.thank_you_url` column has existed
   since the original schema, is collected by the test-creation form, and validated — but nothing
   ever read it. The operator was expected to hand-copy a pixel snippet from the README and
   manually substitute the domain and test slug, which already caused two documentation bugs. This
   surfaces `thank_you_url` per variant on the report page next to a ready-to-paste snippet with
   the real domain and slug already filled in — same mechanism (a pixel pasted on the operator's
   own thank-you page), zero manual substitution.

## Still out of scope

Everything the original spec excluded remains excluded: automatic winner declaration, audience
segmentation by device/geo at split time (the UTM breakdown above is read-only reporting, not a
new split dimension), non-Hubla checkout integrations, self-service multi-tenancy, full test
editing (renaming, changing URLs/weights after creation — only the status toggle is in scope).

## Infrastructure cost note (no architecture change)

Vercel Hobby (100GB bandwidth/mo) and Supabase Free (500MB DB, 5GB egress, project pauses after 7
days fully idle — not a risk here since the dashboard is used daily) comfortably cover the
expected internal volume (a handful of clients, thousands of clicks/month, not millions). No
paid tier is needed to ship this. If the usage widget (addition 4) starts showing numbers that
approach these limits, that's the trigger to revisit — not something to solve preemptively now.

## Task mapping

Implemented as Tasks 16–21 appended to
[2026-08-25-ab-test-tool.md](../plans/2026-08-25-ab-test-tool.md):

- Task 16 → addition 1 (bot filtering), extends Task 6.
- Task 17 → addition 2 (confidence indicator), extends Task 14; also closes a pre-existing minor
  finding from the final review (leader highlight showing on an all-zero-visits test).
- Task 18 → addition 3 (source breakdown), extends Task 2 (new RPC, `supabase/migrations/0003_...`
  since `0002` is already the report conversion-method fix from the final review) and Task 14.
- Task 19 → addition 4 (usage widget), extends Task 2 (new RPC, `supabase/migrations/0004_...`)
  and Task 11 (dashboard page).
- Task 20 → addition 5 (pause/activate), extends Task 14.
- Task 21 → addition 6 (thank-you pixel snippet), extends Task 14/20.
