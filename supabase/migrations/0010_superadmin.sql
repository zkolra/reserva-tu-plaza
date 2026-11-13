-- Superadmin de la plataforma: crear escuelas, dar acceso a sus dueños
-- y entrar en el panel de cualquier escuela para ayudar a configurarla.

create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
create policy "admins see themselves" on platform_admins for select using (user_id = auth.uid());

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- El superadmin cuenta como equipo de todas las escuelas
create or replace function is_studio_staff(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from studio_staff where studio_id = sid and user_id = auth.uid());
$$;

-- Invitaciones: el dueño puede no tener cuenta todavía.
-- Al entrar por primera vez con ese email, recibe acceso automáticamente.
create table if not exists studio_invites (
  studio_id  uuid not null references studios(id) on delete cascade,
  email      text not null,
  role       staff_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (studio_id, email)
);
alter table studio_invites enable row level security;
create policy "staff see invites" on studio_invites for select using (is_studio_staff(studio_id));

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;

  insert into studio_staff (studio_id, user_id, role)
  select i.studio_id, new.id, i.role from studio_invites i where lower(i.email) = lower(new.email)
  on conflict do nothing;
  delete from studio_invites where lower(email) = lower(new.email);
  return new;
end;
$$;

-- Dar acceso a una persona (si ya tiene cuenta, al momento; si no, al entrar)
create or replace function add_studio_member(p_studio uuid, p_email text, p_role staff_role default 'owner')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not is_studio_staff(p_studio) then
    raise exception 'Sin permiso';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email no válido';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    insert into studio_staff (studio_id, user_id, role) values (p_studio, v_user, p_role)
    on conflict (studio_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;
  insert into studio_invites (studio_id, email, role) values (p_studio, v_email, p_role)
  on conflict (studio_id, email) do update set role = excluded.role;
  return 'invited';
end;
$$;

-- Crear una escuela nueva con lo básico ya configurado
create or replace function create_studio(p_name text, p_slug text, p_owner_email text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := lower(trim(p_slug));
  v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'Solo el administrador de la plataforma puede crear escuelas';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre de la escuela';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'La dirección solo puede tener letras, números y guiones (3–40 caracteres)';
  end if;
  if v_slug in ('admin', 'superadmin', 'api', 'demo', 'login', 'app', 'www') then
    raise exception 'Esa dirección está reservada';
  end if;
  if exists (select 1 from studios where slug = v_slug) then
    raise exception 'Ya existe una escuela con la dirección «%»', v_slug;
  end if;

  insert into studios (name, slug, renewal_mode) values (trim(p_name), v_slug, 'choice')
  returning id into v_id;

  insert into studio_modules (studio_id, module, enabled)
  values (v_id, 'classes', true), (v_id, 'payments', true), (v_id, 'roles', false), (v_id, 'waitlist', false);

  insert into plans (studio_id, kind, name, price_cents, classes_per_week, class_count, sort) values
    (v_id, 'trial',              'Clase de prueba',     1000, null, 1,    0),
    (v_id, 'monthly_by_classes', '1 clase por semana',  3500, 1,    null, 1),
    (v_id, 'monthly_by_classes', '2 clases por semana', 6000, 2,    null, 2),
    (v_id, 'monthly_by_classes', '3 clases por semana', 8500, 3,    null, 3);

  if coalesce(trim(p_owner_email), '') <> '' then
    perform add_studio_member(v_id, p_owner_email, 'owner');
  end if;

  return v_id;
end;
$$;

-- Resumen de todas las escuelas para el superadmin
create or replace function platform_studios()
returns table (
  id uuid, name text, slug text, created_at timestamptz,
  owners text, invited text, classes int, active_memberships int, trials int
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.name, s.slug, s.created_at,
    (select string_agg(p.email, ', ') from studio_staff st join profiles p on p.user_id = st.user_id where st.studio_id = s.id),
    (select string_agg(i.email, ', ') from studio_invites i where i.studio_id = s.id),
    (select count(*)::int from class_series c where c.studio_id = s.id and c.active),
    (select count(*)::int from memberships m where m.studio_id = s.id and m.status = 'active'),
    (select count(*)::int from trial_bookings t where t.studio_id = s.id)
  from studios s
  where is_platform_admin()
  order by s.created_at desc;
$$;

-- El superadmin puede borrar escuelas (con todo lo suyo)
create policy "platform admin delete studios" on studios for delete using (is_platform_admin());

revoke execute on function is_platform_admin() from public, anon;
revoke execute on function add_studio_member(uuid, text, staff_role) from public, anon;
revoke execute on function create_studio(text, text, text) from public, anon;
revoke execute on function platform_studios() from public, anon;
grant execute on function is_platform_admin() to authenticated;
grant execute on function add_studio_member(uuid, text, staff_role) to authenticated;
grant execute on function create_studio(text, text, text) to authenticated;
grant execute on function platform_studios() to authenticated;
grant select on platform_admins, studio_invites to authenticated;
