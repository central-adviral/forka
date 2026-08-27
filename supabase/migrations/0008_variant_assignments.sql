create table variant_assignments (
  test_id uuid not null references tests(id) on delete cascade,
  visitor_id text not null,
  variant_id uuid not null references variants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (test_id, visitor_id)
);

alter table variant_assignments enable row level security;

create policy "variant_assignments_select_via_client_owner" on variant_assignments
  for select using (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = variant_assignments.test_id and c.owner_id = auth.uid()
  ));

grant select on variant_assignments to authenticated;
grant select, insert, update, delete on variant_assignments to service_role;
