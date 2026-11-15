-- Asistencia: quién está apuntado a cada clase de un día (abono, prueba, visitantes)
-- y quién vino.

create table if not exists class_attendance (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id) on delete cascade,
  series_id   uuid not null references class_series(id) on delete cascade,
  class_date  date not null,
  user_id     uuid references auth.users(id) on delete cascade,   -- null = visitante sin cuenta
  guest_name  text,
  present     boolean not null default true,
  marked_by   uuid references auth.users(id) on delete set null,
  marked_at   timestamptz not null default now(),
  unique (series_id, class_date, user_id),
  check (user_id is not null or guest_name is not null)
);
create index if not exists class_attendance_day on class_attendance (studio_id, class_date);

alter table class_attendance enable row level security;
create policy "staff manage attendance" on class_attendance for all using (is_studio_staff(studio_id));
create policy "own attendance" on class_attendance for select using (user_id = auth.uid());
grant select, insert, update, delete on class_attendance to authenticated;

-- Lista de cada clase de un día: alumnos con abono ese día, clases de prueba y visitantes
create or replace function class_roster_day(p_studio uuid, p_date date)
returns table (
  series_id uuid, user_id uuid, attendance_id uuid, name text, email text, phone text,
  role dance_role, kind text, present boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_studio_staff(p_studio) then
    raise exception 'Sin permiso';
  end if;

  return query
  with s as (
    select cs.id from class_series cs
    where cs.studio_id = p_studio and cs.weekday = extract(isodow from p_date)
  ),
  mem as (
    -- Un abono cuenta si cubre ese día. Al cambiar de clases, el abono anterior
    -- termina ese mismo día y el nuevo empieza: no se duplica.
    select distinct on (ms.series_id, m.user_id) ms.series_id, m.user_id, ms.role, 'abono'::text as kind
    from membership_series ms
    join memberships m on m.id = ms.membership_id
    where ms.series_id in (select id from s)
      and m.studio_id = p_studio
      and m.starts_on <= p_date
      and (m.ends_on is null or m.ends_on > p_date or (m.ends_on = p_date and m.status <> 'cancelled'))
    order by ms.series_id, m.user_id, m.created_at desc
  ),
  tri as (
    select t.series_id, t.user_id, t.role, 'prueba'::text as kind
    from trial_bookings t
    where t.studio_id = p_studio and t.class_date = p_date and t.status <> 'cancelled'
      and t.series_id in (select id from s)
  ),
  people as (
    select * from mem
    union all
    select * from tri
    where not exists (select 1 from mem where mem.series_id = tri.series_id and mem.user_id = tri.user_id)
  )
  select p.series_id, p.user_id, a.id, coalesce(nullif(pr.full_name, ''), pr.email, 'Alumno'),
         pr.email, pr.phone, p.role, p.kind, a.present
  from people p
  left join profiles pr on pr.user_id = p.user_id
  left join class_attendance a on a.series_id = p.series_id and a.class_date = p_date and a.user_id = p.user_id
  union all
  select a.series_id, null::uuid, a.id, a.guest_name, null::text, null::text, 'none'::dance_role, 'visitante'::text, a.present
  from class_attendance a
  where a.studio_id = p_studio and a.class_date = p_date and a.user_id is null
  order by 1, 4;
end;
$$;

-- Marcar si un alumno vino (o quitar la marca con p_present = null)
create or replace function set_attendance(p_series uuid, p_date date, p_user uuid, p_present boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from class_series where id = p_series;
  if v_studio is null or not is_studio_staff(v_studio) then
    raise exception 'Sin permiso';
  end if;

  if p_present is null then
    delete from class_attendance where series_id = p_series and class_date = p_date and user_id = p_user;
  else
    insert into class_attendance (studio_id, series_id, class_date, user_id, present, marked_by)
    values (v_studio, p_series, p_date, p_user, p_present, auth.uid())
    on conflict (series_id, class_date, user_id)
    do update set present = excluded.present, marked_by = excluded.marked_by, marked_at = now();
  end if;

  -- La clase de prueba queda como «asistió»
  update trial_bookings set status = case when p_present then 'attended' else 'booked' end
  where series_id = p_series and class_date = p_date and user_id = p_user and status <> 'cancelled';
end;
$$;

-- Apuntar a alguien que vino sin estar en la lista
create or replace function add_attendance_guest(p_series uuid, p_date date, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
  v_id uuid;
begin
  select studio_id into v_studio from class_series where id = p_series;
  if v_studio is null or not is_studio_staff(v_studio) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre';
  end if;
  insert into class_attendance (studio_id, series_id, class_date, guest_name, present, marked_by)
  values (v_studio, p_series, p_date, trim(p_name), true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function class_roster_day(uuid, date) from public, anon;
revoke execute on function set_attendance(uuid, date, uuid, boolean) from public, anon;
revoke execute on function add_attendance_guest(uuid, date, text) from public, anon;
grant execute on function class_roster_day(uuid, date) to authenticated;
grant execute on function set_attendance(uuid, date, uuid, boolean) to authenticated;
grant execute on function add_attendance_guest(uuid, date, text) to authenticated;
