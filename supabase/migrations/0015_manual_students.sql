-- 1) La escuela puede apuntar alumnos a mano (pagó en efectivo, no tiene cuenta todavía).
-- 2) Asistencia: apuntar a alguien en días futuros y con rol; alumnos sin cuenta en la lista.

-- ── Abonos sin cuenta de usuario ──
alter table memberships alter column user_id drop not null;
alter table memberships add column if not exists guest_name text;
alter table memberships add column if not exists guest_email text;
alter table memberships add column if not exists guest_phone text;
alter table memberships add column if not exists payment_method text not null default 'online'
  check (payment_method in ('online', 'cash', 'transfer', 'other'));
alter table memberships add column if not exists created_by uuid references auth.users(id) on delete set null;
do $$ begin
  alter table memberships add constraint memberships_who check (user_id is not null or guest_name is not null or guest_email is not null);
exception when duplicate_object then null; end $$;

-- Cuando esa persona entra por primera vez con su email, el abono pasa a su cuenta
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;

  insert into studio_staff (studio_id, user_id, role)
  select i.studio_id, new.id, i.role from studio_invites i where lower(i.email) = lower(new.email)
  on conflict do nothing;
  delete from studio_invites where lower(email) = lower(new.email);

  update profiles p set
    full_name = coalesce(p.full_name, m.guest_name),
    phone = coalesce(p.phone, m.guest_phone)
  from (select guest_name, guest_phone from memberships
        where user_id is null and lower(guest_email) = lower(new.email)
        order by created_at desc limit 1) m
  where p.user_id = new.id;

  insert into studio_students (studio_id, user_id)
  select distinct studio_id, new.id from memberships
  where user_id is null and lower(guest_email) = lower(new.email)
  on conflict do nothing;

  update memberships set user_id = new.id
  where user_id is null and lower(guest_email) = lower(new.email);
  return new;
end;
$$;

-- La escuela apunta a un alumno: clases, rol, meses pagados y forma de pago
create or replace function admin_create_membership(
  p_studio uuid, p_series uuid[], p_role dance_role, p_name text, p_email text, p_phone text,
  p_months int default 1, p_payment text default 'cash', p_enrollment boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_n int := coalesce(array_length(p_series, 1), 0);
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_user uuid;
  v_old uuid;
  v_plan uuid;
  v_fee int := 0;
  v_id uuid;
  v_role dance_role;
  v_taken int;
  v_cap int;
  r record;
begin
  if not is_studio_staff(p_studio) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(trim(p_name), '') = '' and v_email is null then
    raise exception 'Escribe el nombre del alumno';
  end if;
  if v_n = 0 then
    raise exception 'Elige al menos una clase';
  end if;
  if coalesce(p_months, 0) < 1 or p_months > 12 then
    raise exception 'Los meses deben estar entre 1 y 12';
  end if;
  if (select count(*) from class_series where id = any(p_series) and studio_id = p_studio and active) <> v_n then
    raise exception 'Alguna clase ya no está disponible';
  end if;
  if exists (select 1 from class_series where id = any(p_series) and uses_roles)
     and coalesce(p_role, 'none') not in ('leader', 'follower') then
    raise exception 'Elige Leader o Follower';
  end if;

  if v_email is not null then
    select id into v_user from auth.users where lower(email) = v_email;
  end if;

  -- Abono activo anterior de esa persona (se sustituye)
  select id into v_old from memberships
  where studio_id = p_studio and status = 'active'
    and ((v_user is not null and user_id = v_user)
      or (v_user is null and v_email is not null and user_id is null and lower(guest_email) = v_email))
  limit 1;

  for r in select * from class_series where id = any(p_series) and studio_id = p_studio order by id for update loop
    v_role := case when r.uses_roles then p_role else 'none'::dance_role end;
    select count(*) into v_taken
    from membership_series ms join memberships m on m.id = ms.membership_id
    where ms.series_id = r.id and m.status = 'active'
      and (v_old is null or m.id <> v_old)
      and (not r.uses_roles or ms.role = v_role);
    v_cap := case when not r.uses_roles then r.capacity when v_role = 'leader' then r.capacity_leaders else r.capacity_followers end;
    if v_taken >= v_cap then
      raise exception 'La clase «%» ya no tiene plazas', r.name;
    end if;
  end loop;

  select id into v_plan from plans where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week = v_n;
  if v_plan is null then
    select id into v_plan from plans where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week is null;
  end if;
  if v_plan is null then
    select id into v_plan from plans where studio_id = p_studio and active and kind = 'monthly_by_classes' order by classes_per_week desc limit 1;
  end if;
  if v_plan is null then
    raise exception 'Primero crea los precios del abono en «Precios»';
  end if;

  if p_enrollment then
    select enrollment_fee_cents into v_fee from studios where id = p_studio;
  end if;

  if v_old is not null then
    update memberships set status = 'cancelled', ends_on = current_date where id = v_old;
  end if;

  if v_user is not null then
    insert into profiles (user_id) values (v_user) on conflict do nothing;
    insert into studio_students (studio_id, user_id, default_role) values (p_studio, v_user, coalesce(p_role, 'none'))
    on conflict (studio_id, user_id) do nothing;
  end if;

  insert into memberships (
    studio_id, user_id, plan_id, status, starts_on, ends_on, auto_renew, enrollment_fee_cents,
    guest_name, guest_email, guest_phone, payment_method, created_by
  ) values (
    p_studio, v_user, v_plan, 'active', current_date, (current_date + make_interval(months => p_months))::date, false,
    coalesce(v_fee, 0), nullif(trim(p_name), ''), v_email, nullif(trim(coalesce(p_phone, '')), ''),
    coalesce(p_payment, 'cash'), auth.uid()
  ) returning id into v_id;

  insert into membership_series (membership_id, series_id, role)
  select v_id, cs.id, case when cs.uses_roles then p_role else 'none'::dance_role end
  from class_series cs where cs.id = any(p_series);

  return v_id;
end;
$$;

-- ── Asistencia ──
alter table class_attendance alter column present drop not null;            -- null = apuntado, aún sin marcar
alter table class_attendance add column if not exists membership_id uuid references memberships(id) on delete cascade;
alter table class_attendance add column if not exists role dance_role not null default 'none';
alter table class_attendance drop constraint if exists class_attendance_check;
do $$ begin
  alter table class_attendance add constraint class_attendance_who
    check (user_id is not null or membership_id is not null or guest_name is not null);
exception when duplicate_object then null; end $$;
create unique index if not exists class_attendance_membership_day
  on class_attendance (series_id, class_date, membership_id) where membership_id is not null;

drop function if exists class_roster_day(uuid, date);
create function class_roster_day(p_studio uuid, p_date date)
returns table (
  series_id uuid, user_id uuid, membership_id uuid, attendance_id uuid, name text, email text, phone text,
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
    select distinct on (ms.series_id, coalesce(m.user_id, m.id))
      ms.series_id, m.user_id, m.id as membership_id, ms.role, 'abono'::text as kind,
      m.guest_name, m.guest_email, m.guest_phone
    from membership_series ms
    join memberships m on m.id = ms.membership_id
    where ms.series_id in (select id from s)
      and m.studio_id = p_studio
      and m.starts_on <= p_date
      and (m.ends_on is null or m.ends_on > p_date or (m.ends_on = p_date and m.status <> 'cancelled'))
    order by ms.series_id, coalesce(m.user_id, m.id), m.created_at desc
  ),
  tri as (
    select t.series_id, t.user_id, null::uuid as membership_id, t.role, 'prueba'::text as kind,
      null::text as guest_name, null::text as guest_email, null::text as guest_phone
    from trial_bookings t
    where t.studio_id = p_studio and t.class_date = p_date and t.status <> 'cancelled'
      and t.series_id in (select id from s)
      and not exists (select 1 from mem where mem.series_id = t.series_id and mem.user_id = t.user_id)
  ),
  people as (select * from mem union all select * from tri)
  select p.series_id, p.user_id, p.membership_id, a.id,
         coalesce(nullif(pr.full_name, ''), p.guest_name, pr.email, p.guest_email, 'Alumno'),
         coalesce(pr.email, p.guest_email), coalesce(pr.phone, p.guest_phone), p.role, p.kind, a.present
  from people p
  left join profiles pr on pr.user_id = p.user_id
  left join class_attendance a on a.series_id = p.series_id and a.class_date = p_date
    and ((p.user_id is not null and a.user_id = p.user_id)
      or (p.user_id is null and a.membership_id = p.membership_id))
  union all
  select a.series_id, null::uuid, null::uuid, a.id, a.guest_name, null::text, null::text, a.role, 'visitante'::text, a.present
  from class_attendance a
  where a.studio_id = p_studio and a.class_date = p_date and a.user_id is null and a.membership_id is null
  order by 1, 5;
end;
$$;

-- Marcar asistencia de un alumno con cuenta (p_user) o sin cuenta (p_membership)
create or replace function set_attendance_v2(p_series uuid, p_date date, p_user uuid, p_membership uuid, p_present boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from class_series where id = p_series;
  if v_studio is null or not is_studio_staff(v_studio) then
    raise exception 'Sin permiso';
  end if;

  if p_user is not null then
    perform set_attendance(p_series, p_date, p_user, p_present);
    return;
  end if;
  if p_present is null then
    delete from class_attendance where series_id = p_series and class_date = p_date and membership_id = p_membership;
  else
    insert into class_attendance (studio_id, series_id, class_date, membership_id, present, marked_by)
    values (v_studio, p_series, p_date, p_membership, p_present, auth.uid())
    on conflict (series_id, class_date, membership_id) where membership_id is not null
    do update set present = excluded.present, marked_by = excluded.marked_by, marked_at = now();
  end if;
end;
$$;

-- Apuntar a alguien sin reserva, también para días futuros (queda «apuntado» hasta marcarlo)
drop function if exists add_attendance_guest(uuid, date, text);
create function add_attendance_guest(p_series uuid, p_date date, p_name text, p_role dance_role default 'none')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
  v_tz text;
  v_id uuid;
begin
  select cs.studio_id, coalesce(s.timezone, 'Europe/Madrid') into v_studio, v_tz
  from class_series cs join studios s on s.id = cs.studio_id where cs.id = p_series;
  if v_studio is null or not is_studio_staff(v_studio) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre';
  end if;
  insert into class_attendance (studio_id, series_id, class_date, guest_name, role, present, marked_by)
  values (v_studio, p_series, p_date, trim(p_name), coalesce(p_role, 'none'),
          case when p_date < (now() at time zone v_tz)::date then true else null end, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function admin_create_membership(uuid, uuid[], dance_role, text, text, text, int, text, boolean) from public, anon;
revoke execute on function class_roster_day(uuid, date) from public, anon;
revoke execute on function set_attendance_v2(uuid, date, uuid, uuid, boolean) from public, anon;
revoke execute on function add_attendance_guest(uuid, date, text, dance_role) from public, anon;
grant execute on function admin_create_membership(uuid, uuid[], dance_role, text, text, text, int, text, boolean) to authenticated;
grant execute on function class_roster_day(uuid, date) to authenticated;
grant execute on function set_attendance_v2(uuid, date, uuid, uuid, boolean) to authenticated;
grant execute on function add_attendance_guest(uuid, date, text, dance_role) to authenticated;
