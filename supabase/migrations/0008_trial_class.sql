-- Clase de prueba: una sola clase, una sola vez, solo para alumnos nuevos.
-- Se reserva la próxima fecha de la clase elegida.

create table if not exists trial_bookings (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references studios(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  series_id    uuid not null references class_series(id) on delete cascade,
  class_date   date not null,
  role         dance_role not null default 'none',
  price_cents  int not null default 0,
  status       text not null default 'booked' check (status in ('booked', 'attended', 'cancelled')),
  created_at   timestamptz not null default now(),
  unique (studio_id, user_id)            -- una vez por estudio
);

alter table trial_bookings enable row level security;
create policy "staff manage trials" on trial_bookings for all using (is_studio_staff(studio_id));
create policy "own trials" on trial_bookings for select using (user_id = auth.uid());
grant select on trial_bookings to authenticated;
grant insert, update, delete on trial_bookings to authenticated;

-- ¿Puede este usuario reservar una clase de prueba? (nunca tuvo abono ni prueba)
create or replace function trial_available(p_studio uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and exists (select 1 from plans where studio_id = p_studio and kind = 'trial' and active)
    and not exists (select 1 from memberships where studio_id = p_studio and user_id = auth.uid())
    and not exists (select 1 from trial_bookings where studio_id = p_studio and user_id = auth.uid());
$$;

create or replace function book_trial(p_studio uuid, p_series uuid, p_role dance_role)
returns date
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_price int;
  v_tz text;
  v_now timestamp;
  v_date date;
  v_role dance_role;
  v_taken int;
  v_cap int;
  r record;
begin
  if v_user is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if exists (select 1 from memberships where studio_id = p_studio and user_id = v_user)
     or exists (select 1 from trial_bookings where studio_id = p_studio and user_id = v_user) then
    raise exception 'La clase de prueba es solo para alumnos nuevos';
  end if;

  select price_cents into v_price from plans where studio_id = p_studio and kind = 'trial' and active limit 1;
  if v_price is null then
    raise exception 'Este estudio no ofrece clase de prueba';
  end if;

  select * into r from class_series where id = p_series and studio_id = p_studio and active for update;
  if r.id is null then
    raise exception 'La clase ya no está disponible';
  end if;

  -- Próxima fecha de esa clase en la hora local del estudio
  select timezone into v_tz from studios where id = p_studio;
  v_now := now() at time zone coalesce(v_tz, 'Europe/Madrid');
  v_date := v_now::date + ((r.weekday - extract(isodow from v_now)::int + 7) % 7);
  if v_date = v_now::date and r.start_time <= v_now::time then
    v_date := v_date + 7;
  end if;

  v_role := case when r.uses_roles then p_role else 'none'::dance_role end;
  if r.uses_roles and v_role not in ('leader', 'follower') then
    raise exception 'Rol no válido';
  end if;

  -- Plazas: abonos activos + otras pruebas ese mismo día
  select
    (select count(*) from membership_series ms join memberships m on m.id = ms.membership_id
      where ms.series_id = r.id and m.status = 'active' and (not r.uses_roles or ms.role = v_role))
    + (select count(*) from trial_bookings t
      where t.series_id = r.id and t.class_date = v_date and t.status = 'booked' and (not r.uses_roles or t.role = v_role))
  into v_taken;

  v_cap := case
    when not r.uses_roles then r.capacity
    when v_role = 'leader' then r.capacity_leaders
    else r.capacity_followers
  end;
  if v_taken >= v_cap then
    raise exception 'La clase «%» ya no tiene plazas ese día', r.name;
  end if;

  insert into profiles (user_id) values (v_user) on conflict do nothing;
  insert into studio_students (studio_id, user_id, default_role, used_trial)
  values (p_studio, v_user, v_role, true)
  on conflict (studio_id, user_id) do update set used_trial = true;

  insert into trial_bookings (studio_id, user_id, series_id, class_date, role, price_cents)
  values (p_studio, v_user, r.id, v_date, v_role, v_price);

  return v_date;
end;
$$;

revoke execute on function trial_available(uuid) from public, anon;
revoke execute on function book_trial(uuid, uuid, dance_role) from public, anon;
grant execute on function trial_available(uuid) to authenticated;
grant execute on function book_trial(uuid, uuid, dance_role) to authenticated;
