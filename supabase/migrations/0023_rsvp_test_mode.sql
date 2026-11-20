-- «Voy / No voy» del alumno para una clase concreta, y modo prueba de la escuela.

create table if not exists class_rsvp (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  series_id uuid not null references class_series(id) on delete cascade,
  class_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  going boolean not null,
  updated_at timestamptz not null default now(),
  unique (series_id, class_date, user_id)
);
alter table class_rsvp enable row level security;
drop policy if exists "own rsvp" on class_rsvp;
create policy "own rsvp" on class_rsvp for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "staff read rsvp" on class_rsvp;
create policy "staff read rsvp" on class_rsvp for select using (is_studio_staff(studio_id));
grant select, insert, update, delete on class_rsvp to authenticated;

-- El alumno marca si viene (solo a clases de su abono, desde hoy)
create or replace function set_my_rsvp(p_series uuid, p_date date, p_going boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if p_date < current_date - 1 then
    raise exception 'Esa clase ya pasó';
  end if;
  select cs.studio_id into v_studio
  from membership_series ms
  join memberships m on m.id = ms.membership_id
  join class_series cs on cs.id = ms.series_id
  where ms.series_id = p_series and m.user_id = auth.uid() and m.status = 'active'
    and m.starts_on <= p_date and (m.ends_on is null or m.ends_on >= p_date)
  limit 1;
  if v_studio is null then
    raise exception 'Esta clase no está en tu abono';
  end if;
  insert into class_rsvp (studio_id, series_id, class_date, user_id, going, updated_at)
  values (v_studio, p_series, p_date, auth.uid(), p_going, now())
  on conflict (series_id, class_date, user_id) do update set going = excluded.going, updated_at = now();
end;
$$;
revoke execute on function set_my_rsvp(uuid, date, boolean) from public, anon;
grant execute on function set_my_rsvp(uuid, date, boolean) to authenticated;

alter table studios add column if not exists test_mode boolean not null default false;
