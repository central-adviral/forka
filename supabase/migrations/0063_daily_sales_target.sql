-- Central de Tráfego: the daily target of entry sales of a project, so "Hoje" can say by early
-- afternoon whether the day will close on target.

alter table sales_funnels add column daily_sales_target integer check (daily_sales_target > 0);
