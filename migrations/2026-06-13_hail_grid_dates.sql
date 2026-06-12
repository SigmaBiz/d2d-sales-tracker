-- migrations/2026-06-13_hail_grid_dates.sql
-- Per-date rollup of hail_grid for the "Available Storm Maps" list.
-- security_invoker is REQUIRED: without it the view runs as postgres and
-- bypasses hail_grid RLS (exposing rows to anon).
create or replace view hail_grid_dates
with (security_invoker = true) as
select date, count(*)::int as point_count, max(size_inches) as max_size_inches
from hail_grid group by date;

grant select on hail_grid_dates to authenticated;
