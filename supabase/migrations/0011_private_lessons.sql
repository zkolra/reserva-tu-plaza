-- Clases particulares: profesores, opciones con precio, horario disponible,
-- bloqueos, reservas (del alumno o hechas por la escuela) y bonos.
-- Es el mismo motor que servirá para alquiler de salas y profesionales individuales.

-- Nuevo módulo
alter table studio_modules drop constraint if exists studio_modules_module_check;
alter table studio_modules add constraint studio_modules_module_check
  check (module in ('classes', 'payments', 'roles', 'waitlist', 'room_rental', 'online', 'private'));

alter table studios add column if not exists private_requires_confirmation boolean not null default false;
alter table studios add column if not exists private_styles text[] not null default '{}';

create table if not exists teachers (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references studios(id) on delete cascade,
  name            text not null,
  offers_private  boolean not null default true,
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);

-- Opción reservable: «Solo Gabriel», «Gabriel + Sirine»… con duración y precio
create table if not exists private_options (
  id            uuid primary key default gen_random_uuid(),
  studio_id     uuid not null references studios(id) on delete cascade,
  name          text not null,
  teacher_ids   uuid[] not null check (cardinality(teacher_ids) >= 1),
  duration_min  int not null default 60 check (duration_min between 15 and 480),
  price_cents   int not null default 0 check (price_cents >= 0),
  online        boolean not null default false,
  active        boolean not null default true,
  sort          int not null default 0
);

-- Horario semanal en que cada profesor acepta clases (franjas ya unidas)
create table if not exists teacher_availability (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id) on delete cascade,
  teacher_id  uuid not null references teachers(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),
  start_time  time not null,
  end_time    time not null check (end_time > start_time)
);

-- Días u horas concretas bloqueadas
create table if not exists teacher_blocks (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id) on delete cascade,
  teacher_id  uuid not null references teachers(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null check (ends_at > starts_at),
  reason      text
);

create table if not exists private_bookings (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references studios(id) on delete cascade,
  option_id    uuid references private_options(id) on delete set null,
  option_name  text not null,
  teacher_ids  uuid[] not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  user_id      uuid references auth.users(id) on delete set null,   -- null si la reservó la escuela
  guest_name   text,
  guest_email  text,
  guest_phone  text,
  style        text,
  role         dance_role not null default 'none',
  status       text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  price_cents  int not null default 0,
  meeting_url  text,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists private_pack_plans (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references studios(id) on delete cascade,
  name         text not null,
  option_id    uuid references private_options(id) on delete cascade,   -- null = vale para cualquier opción
  class_count  int not null check (class_count > 0),
  price_cents  int not null check (price_cents >= 0),
  valid_days   int not null default 90 check (valid_days > 0),
  active       boolean not null default true,
  sort         int not null default 0
);

create index if not exists private_bookings_time on private_bookings (studio_id, starts_at);
create index if not exists teacher_availability_t on teacher_availability (teacher_id, weekday);
create index if not exists teacher_blocks_t on teacher_blocks (teacher_id, starts_at);

-- Seguridad
alter table teachers enable row level security;
alter table private_options enable row level security;
alter table teacher_availability enable row level security;
alter table teacher_blocks enable row level security;
alter table private_bookings enable row level security;
alter table private_pack_plans enable row level security;

create policy "public read teachers" on teachers for select using (active);
create policy "public read private options" on private_options for select using (active);
create policy "public read pack plans" on private_pack_plans for select using (active);
create policy "staff manage teachers" on teachers for all using (is_studio_staff(studio_id));
create policy "staff manage private options" on private_options for all using (is_studio_staff(studio_id));
create policy "staff manage availability" on teacher_availability for all using (is_studio_staff(studio_id));
create policy "staff manage blocks" on teacher_blocks for all using (is_studio_staff(studio_id));
create policy "staff manage private bookings" on private_bookings for all using (is_studio_staff(studio_id));
create policy "staff manage pack plans" on private_pack_plans for all using (is_studio_staff(studio_id));
create policy "own private bookings" on private_bookings for select using (user_id = auth.uid());

grant select on teachers, private_options, private_pack_plans to anon, authenticated;
grant select, insert, update, delete on teachers, private_options, teacher_availability,
  teacher_blocks, private_bookings, private_pack_plans to authenticated;

-- ¿Está ocupado este hueco para estos profesores? (reservas activas y bloqueos)
create or replace function private_slot_taken(p_teachers uuid[], p_start timestamptz, p_end timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from private_bookings b
    where b.status <> 'cancelled' and b.teacher_ids && p_teachers
      and b.starts_at < p_end and p_start < b.ends_at
  ) or exists (
    select 1 from teacher_blocks k
    where k.teacher_id = any(p_teachers) and k.starts_at < p_end and p_start < k.ends_at
  );
$$;

-- Huecos libres de una opción: todos sus profesores disponibles y sin reservas ni bloqueos.
-- Cada 30 minutos, a partir de 2 horas desde ahora, en la hora local de la escuela.
create or replace function private_slots(p_option uuid, p_from date, p_days int default 14)
returns table (starts_at timestamptz, local_date date, local_time text)
language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  v_tz text;
  v_n int;
  v_dur interval;
begin
  select * into o from private_options where id = p_option and active;
  if o.id is null then
    return;
  end if;
  select coalesce(timezone, 'Europe/Madrid') into v_tz from studios where id = o.studio_id;
  v_n := cardinality(o.teacher_ids);
  v_dur := make_interval(mins => o.duration_min);

  return query
  with cand as (
    select (p_from + i)::date as d, ((p_from + i)::date + h * interval '30 minutes')::timestamp as ls
    from generate_series(0, least(greatest(p_days, 1), 62) - 1) i,
         generate_series(0, 47) h
  ),
  ok as (
    select c.d, c.ls, (c.ls at time zone v_tz) as st
    from cand c
    where (c.ls + v_dur)::date = c.d
      and (
        select count(distinct a.teacher_id)
        from teacher_availability a
        join teachers te on te.id = a.teacher_id and te.active and te.offers_private
        where a.teacher_id = any(o.teacher_ids)
          and a.weekday = extract(isodow from c.d)
          and a.start_time <= c.ls::time
          and (c.ls + v_dur)::time <= a.end_time
      ) = v_n
  )
  select ok.st, ok.d, to_char(ok.ls, 'HH24:MI')
  from ok
  where ok.st > now() + interval '2 hours'
    and not private_slot_taken(o.teacher_ids, ok.st, ok.st + v_dur)
  order by ok.st;
end;
$$;

-- Reserva del alumno (con sesión). Comprueba que el hueco sigue libre.
create or replace function book_private(
  p_option uuid, p_start timestamptz, p_style text, p_role dance_role, p_name text, p_phone text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  o record;
  s record;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  select * into o from private_options where id = p_option and active;
  if o.id is null then
    raise exception 'Esta opción ya no está disponible';
  end if;
  select * into s from studios where id = o.studio_id;
  if not exists (select 1 from studio_modules where studio_id = s.id and module = 'private' and enabled) then
    raise exception 'Esta escuela no ofrece clases particulares';
  end if;

  perform pg_advisory_xact_lock(hashtext('private:' || s.id::text));

  if not exists (
    select 1 from private_slots(p_option, (p_start at time zone coalesce(s.timezone, 'Europe/Madrid'))::date, 1) x
    where x.starts_at = p_start
  ) then
    raise exception 'Ese horario ya no está libre. Elige otro.';
  end if;

  insert into profiles (user_id) values (v_user) on conflict do nothing;
  if coalesce(trim(p_name), '') <> '' then
    update profiles set full_name = coalesce(full_name, trim(p_name)) where user_id = v_user;
  end if;
  if coalesce(trim(p_phone), '') <> '' then
    update profiles set phone = trim(p_phone) where user_id = v_user;
  end if;
  insert into studio_students (studio_id, user_id) values (s.id, v_user) on conflict do nothing;

  insert into private_bookings (
    studio_id, option_id, option_name, teacher_ids, starts_at, ends_at, user_id,
    guest_name, guest_email, guest_phone, style, role, status, price_cents, meeting_url, created_by
  ) values (
    s.id, o.id, o.name, o.teacher_ids, p_start, p_start + make_interval(mins => o.duration_min), v_user,
    nullif(trim(p_name), ''), (select email from auth.users where id = v_user), nullif(trim(p_phone), ''),
    nullif(trim(p_style), ''), coalesce(p_role, 'none'),
    case when s.private_requires_confirmation then 'pending' else 'confirmed' end,
    o.price_cents,
    case when o.online then 'https://meet.jit.si/' || s.slug || '-' || substr(md5(random()::text), 1, 10) end,
    v_user
  ) returning id into v_id;

  return v_id;
end;
$$;

-- Reserva hecha por la escuela (p. ej. por teléfono). Puede salirse del horario
-- disponible, pero no pisar otra reserva o un bloqueo.
create or replace function admin_book_private(
  p_option uuid, p_start timestamptz, p_name text, p_phone text, p_email text, p_style text, p_role dance_role, p_notes text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o record;
  s record;
  v_end timestamptz;
  v_id uuid;
begin
  select * into o from private_options where id = p_option;
  if o.id is null or not is_studio_staff(o.studio_id) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre del alumno';
  end if;
  select * into s from studios where id = o.studio_id;
  v_end := p_start + make_interval(mins => o.duration_min);

  perform pg_advisory_xact_lock(hashtext('private:' || s.id::text));
  if private_slot_taken(o.teacher_ids, p_start, v_end) then
    raise exception 'A esa hora ya hay otra clase o un bloqueo';
  end if;

  insert into private_bookings (
    studio_id, option_id, option_name, teacher_ids, starts_at, ends_at,
    guest_name, guest_email, guest_phone, style, role, status, price_cents, meeting_url, notes, created_by
  ) values (
    s.id, o.id, o.name, o.teacher_ids, p_start, v_end,
    trim(p_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''),
    nullif(trim(p_style), ''), coalesce(p_role, 'none'), 'confirmed', o.price_cents,
    case when o.online then 'https://meet.jit.si/' || s.slug || '-' || substr(md5(random()::text), 1, 10) end,
    nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function private_slot_taken(uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function book_private(uuid, timestamptz, text, dance_role, text, text) from public, anon;
revoke execute on function admin_book_private(uuid, timestamptz, text, text, text, text, dance_role, text) from public, anon;
grant execute on function private_slots(uuid, date, int) to anon, authenticated;
grant execute on function book_private(uuid, timestamptz, text, dance_role, text, text) to authenticated;
grant execute on function admin_book_private(uuid, timestamptz, text, text, text, text, dance_role, text) to authenticated;
