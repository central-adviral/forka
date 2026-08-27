alter table click_events add column ip text;
create index click_events_test_ip_idx on click_events(test_id, ip);
