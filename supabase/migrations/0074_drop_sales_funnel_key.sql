-- The per-project sale key kept by 0073 for the code that was running then. Every write now
-- upserts on (client_id, source, external_id), so a sale is unique per client and this key goes.

alter table sales drop constraint sales_funnel_source_external_id_key;
