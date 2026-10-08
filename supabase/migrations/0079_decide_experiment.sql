-- Deciding an experiment is one transaction (review of 2026-10-07). The decision used to change the
-- A/B test's traffic and then mark the card in separate requests: if the second failed, all the
-- traffic already went to the winner while the card still said "Rodando". Now both happen here, or
-- neither does.
--
-- Security invoker on purpose: every write goes through the caller's RLS, the same policies the
-- separate requests met (gestor or owner on the card and on the test). A write RLS refuses touches
-- no row without raising, so each one checks it changed something.

create function public.decide_experiment(
  p_item_id uuid,
  p_winner_key text,
  p_result text,
  p_learning text,
  p_publish boolean,
  p_winner_variant_id uuid default null,
  p_send_traffic boolean default false,
  p_make_control boolean default false
) returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_test_id uuid;
  v_rows int;
begin
  -- The A/B test first: the card is only decided if the traffic it promises really moved.
  if p_winner_variant_id is not null and (p_send_traffic or p_make_control) then
    select ab_test_id into v_test_id from public.backlog_items where id = p_item_id;
    -- A card the caller cannot see (RLS) reads as no row: that is a refusal, not a data problem.
    if not found then raise exception 'not allowed to decide this card'; end if;
    if v_test_id is null or not exists (select 1 from public.variants where id = p_winner_variant_id and test_id = v_test_id) then
      raise exception 'winner variant does not belong to the card''s A/B test';
    end if;
    -- The old control loses the flag before the winner takes it: one control at a time (0015).
    if p_make_control then
      update public.variants set is_control = false where test_id = v_test_id and is_control and id <> p_winner_variant_id;
      update public.variants set is_control = true where id = p_winner_variant_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then raise exception 'not allowed to change the A/B test'; end if;
    end if;
    if p_send_traffic then
      update public.variants set weight_pct = case when id = p_winner_variant_id then 100 else 0 end where test_id = v_test_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then raise exception 'not allowed to change the A/B test'; end if;
    end if;
  end if;

  update public.backlog_items
     set status = 'decided',
         decided_at = now(),
         winner_key = p_winner_key,
         result = nullif(btrim(coalesce(p_result, '')), ''),
         learning = p_learning,
         published = published or coalesce(p_publish, false)
   where id = p_item_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'not allowed to decide this card'; end if;

  update public.backlog_variants set status = 'active' where item_id = p_item_id and status = 'winner';
  if p_winner_key is not null then
    update public.backlog_variants set status = 'winner' where item_id = p_item_id and key = p_winner_key;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'winner key % is not a variant of this card', p_winner_key; end if;
  end if;
end;
$function$;

revoke all on function public.decide_experiment(uuid, text, text, text, boolean, uuid, boolean, boolean) from public;
grant execute on function public.decide_experiment(uuid, text, text, text, boolean, uuid, boolean, boolean) to authenticated;
