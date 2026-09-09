-- A click could only ever record one sale. That was fine while every click meant one purchase;
-- it stopped being fine the day an upsell went on sale. The second purchase -- order bump,
-- one-click upsell, subscription renewal -- hit unique (click_event_id, source), the repo
-- translated 23505 into 'duplicate', and the webhook answered 200. Hubla saw a successful
-- delivery, the report showed less revenue than the creative actually produced, and nothing
-- anywhere said a sale had been dropped.
--
-- Uniqueness moves to what is unique by nature: the invoice. conversions_external_event_id_idx
-- already enforces that globally, so a redelivered webhook is still absorbed silently -- the one
-- case where silence is the correct behaviour.
alter table conversions drop constraint conversions_click_event_id_source_key;

-- The thank-you pixel has no invoice to key on: it inserts with external_event_id null and fires
-- again on every reload of the page. Its dedup was that dropped constraint and nothing else, so
-- it keeps it -- scoped to itself, so that freeing the webhook does not turn a browser refresh
-- into revenue.
create unique index conversions_thank_you_page_once_per_click_idx
  on conversions (click_event_id)
  where source = 'thank_you_page';
