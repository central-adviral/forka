-- isKnownBot() classifies traffic by User-Agent, but click_events only ever stored the IP,
-- so a bot classification could never be audited after the fact (2026-09-01: a real Meta ad
-- review crawler was only identifiable by IP range, never proven by its User-Agent).
-- Nullable with no default: existing clicks keep NULL, nothing is rewritten.
alter table click_events add column user_agent text;
