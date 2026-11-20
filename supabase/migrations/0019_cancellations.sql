-- Clases canceladas y días sin clase.
--  · Una clase concreta: series_id + date_from = date_to   («el jueves no hay Salsa»)
--  · Toda la escuela cerrada: series_id vacío + rango     («Navidad, 24–31 dic»)

create table if not exists class_cancellations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  series_id uuid references class_series(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  reason text,
  created_at timestamptz not null default now(),
  check (date_to >= date_from),
  check (series_id is null or date_from = date_to)
);
create index if not exists class_cancellations_studio_idx on class_cancellations (studio_id, date_to);

alter table class_cancellations enable row level security;
drop policy if exists "public read cancellations" on class_cancellations;
create policy "public read cancellations" on class_cancellations for select using (true);
drop policy if exists "staff manage cancellations" on class_cancellations;
create policy "staff manage cancellations" on class_cancellations for all
  using (is_studio_staff(studio_id)) with check (is_studio_staff(studio_id));

grant select on class_cancellations to anon, authenticated;
grant insert, update, delete on class_cancellations to authenticated;

-- ¿Hay clase ese día?
create or replace function is_class_cancelled(p_series uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from class_cancellations c
    join class_series s on s.id = p_series and s.studio_id = c.studio_id
    where p_date between c.date_from and c.date_to
      and (c.series_id is null or c.series_id = p_series)
  );
$$;
