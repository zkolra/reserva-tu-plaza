-- Reserva tu plaza — esquema inicial de la base de datos (Supabase / Postgres)
-- Una sola base para todos los estudios: cada fila lleva studio_id
-- y Row Level Security separa los datos de cada estudio.

-- ─────────────────────────────────────────────
-- Tipos
-- ─────────────────────────────────────────────
create type staff_role      as enum ('owner', 'admin', 'teacher');
create type dance_role      as enum ('leader', 'follower', 'none');
create type booking_status  as enum ('confirmed', 'waitlisted', 'cancelled', 'attended', 'no_show');
create type plan_kind       as enum ('trial', 'drop_in', 'monthly_by_classes', 'pack', 'subscription');
create type billing_period  as enum ('four_weeks', 'calendar_month');
create type membership_status as enum ('active', 'paused', 'expired', 'cancelled');
create type payment_status  as enum ('pending', 'paid', 'failed', 'refunded');

-- ─────────────────────────────────────────────
-- Estudios y su equipo
-- ─────────────────────────────────────────────
create table studios (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique,              -- reservatuplaza.com/<slug>
  timezone           text not null default 'Europe/Madrid',
  currency           text not null default 'EUR',
  default_language   text not null default 'es',
  stripe_account_id  text,                              -- cuenta conectada (Stripe Connect)
  cancel_hours       int  not null default 12,          -- cancelación gratis hasta N horas antes
  billing_period     billing_period not null default 'four_weeks',
  created_at         timestamptz not null default now()
);

-- Módulos que cada estudio activa o desactiva
create table studio_modules (
  studio_id  uuid not null references studios(id) on delete cascade,
  module     text not null check (module in
               ('classes', 'payments', 'roles', 'waitlist', 'room_rental', 'online')),
  enabled    boolean not null default false,
  primary key (studio_id, module)
);

create table studio_staff (
  studio_id  uuid not null references studios(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       staff_role not null default 'admin',
  primary key (studio_id, user_id)
);

-- ─────────────────────────────────────────────
-- Personas
-- ─────────────────────────────────────────────
create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  language   text not null default 'es',
  created_at timestamptz not null default now()
);

-- Alumno de un estudio concreto (una persona puede ir a varios)
create table studio_students (
  studio_id     uuid not null references studios(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  default_role  dance_role not null default 'none',
  used_trial    boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  primary key (studio_id, user_id)
);

-- ─────────────────────────────────────────────
-- Salas, clases semanales y sesiones concretas
-- ─────────────────────────────────────────────
create table rooms (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references studios(id) on delete cascade,
  name       text not null,
  capacity   int
);

-- Clase que se repite cada semana (p. ej. «Salsa en pareja, martes 19:00»)
create table class_series (
  id                  uuid primary key default gen_random_uuid(),
  studio_id           uuid not null references studios(id) on delete cascade,
  name                text not null,
  level               text,
  teachers            text,
  room_id             uuid references rooms(id) on delete set null,
  weekday             smallint not null check (weekday between 1 and 7),  -- 1 = lunes
  start_time          time not null,
  duration_min        int  not null default 60,
  uses_roles          boolean not null default false,   -- plazas separadas líder / seguidor
  capacity            int,                              -- clases sin roles
  capacity_leaders    int,
  capacity_followers  int,
  starts_on           date not null default current_date,
  ends_on             date,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  check (
    (uses_roles and capacity_leaders is not null and capacity_followers is not null)
    or (not uses_roles and capacity is not null)
  )
);

-- Cada día concreto en que se da la clase
create table class_sessions (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id) on delete cascade,
  series_id   uuid references class_series(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  cancelled   boolean not null default false,
  unique (series_id, starts_at)
);

-- ─────────────────────────────────────────────
-- Opciones de pago y abonos
-- ─────────────────────────────────────────────
create table plans (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null references studios(id) on delete cascade,
  kind               plan_kind not null,
  name               text not null,
  price_cents        int  not null check (price_cents >= 0),
  classes_per_week   int,          -- monthly_by_classes: 1, 2, 3…; null = ilimitado
  class_count        int,          -- pack: 4, 8…
  validity_days      int,          -- pack: p. ej. 28
  active             boolean not null default true,
  sort               int not null default 0
);

-- Abono comprado por un alumno
create table memberships (
  id                      uuid primary key default gen_random_uuid(),
  studio_id               uuid not null references studios(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  plan_id                 uuid not null references plans(id),
  status                  membership_status not null default 'active',
  starts_on               date not null,
  ends_on                 date,
  classes_remaining       int,          -- solo para packs
  stripe_subscription_id  text,
  created_at              timestamptz not null default now()
);

-- Clases semanales elegidas dentro del abono (y con qué rol)
create table membership_series (
  membership_id  uuid not null references memberships(id) on delete cascade,
  series_id      uuid not null references class_series(id) on delete cascade,
  role           dance_role not null default 'none',
  primary key (membership_id, series_id)
);

create table payments (
  id                        uuid primary key default gen_random_uuid(),
  studio_id                 uuid not null references studios(id) on delete cascade,
  user_id                   uuid not null references auth.users(id),
  plan_id                   uuid references plans(id),
  membership_id             uuid references memberships(id),
  amount_cents              int not null,
  currency                  text not null default 'EUR',
  status                    payment_status not null default 'pending',
  stripe_payment_intent_id  text unique,
  created_at                timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Reservas (incluye lista de espera)
-- ─────────────────────────────────────────────
create table bookings (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references studios(id) on delete cascade,
  session_id     uuid not null references class_sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  role           dance_role not null default 'none',
  status         booking_status not null default 'confirmed',
  membership_id  uuid references memberships(id),
  payment_id     uuid references payments(id),
  created_at     timestamptz not null default now(),   -- orden en la lista de espera
  unique (session_id, user_id)
);

create index on class_sessions (studio_id, starts_at);
create index on bookings (session_id, status, role);
create index on memberships (studio_id, user_id);

-- ─────────────────────────────────────────────
-- Plazas libres por sesión y rol (lo que ve el alumno)
-- ─────────────────────────────────────────────
create view session_availability with (security_invoker = true) as
select
  s.id                as session_id,
  s.studio_id,
  s.starts_at,
  cs.name,
  cs.level,
  cs.teachers,
  cs.uses_roles,
  cs.capacity         - count(b.*) filter (where b.status = 'confirmed')                          as free_total,
  cs.capacity_leaders - count(b.*) filter (where b.status = 'confirmed' and b.role = 'leader')    as free_leaders,
  cs.capacity_followers - count(b.*) filter (where b.status = 'confirmed' and b.role = 'follower') as free_followers,
  count(b.*) filter (where b.status = 'waitlisted')                                               as waitlisted
from class_sessions s
join class_series cs on cs.id = s.series_id
left join bookings b on b.session_id = s.id
where not s.cancelled
group by s.id, cs.id;

-- ─────────────────────────────────────────────
-- Seguridad: cada estudio solo ve lo suyo
-- ─────────────────────────────────────────────
create function is_studio_staff(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from studio_staff where studio_id = sid and user_id = auth.uid());
$$;

alter table studios           enable row level security;
alter table studio_modules    enable row level security;
alter table studio_staff      enable row level security;
alter table profiles          enable row level security;
alter table studio_students   enable row level security;
alter table rooms             enable row level security;
alter table class_series      enable row level security;
alter table class_sessions    enable row level security;
alter table plans             enable row level security;
alter table memberships       enable row level security;
alter table membership_series enable row level security;
alter table payments          enable row level security;
alter table bookings          enable row level security;

-- Público (el widget en la web): ver estudios, horario, módulos y precios activos
create policy "public read studios"   on studios        for select using (true);
create policy "public read modules"   on studio_modules for select using (true);
create policy "public read series"    on class_series   for select using (active);
create policy "public read sessions"  on class_sessions for select using (not cancelled);
create policy "public read plans"     on plans          for select using (active);
create policy "public read rooms"     on rooms          for select using (true);

-- Equipo del estudio: gestiona todo lo de su estudio
create policy "staff manage studio"   on studios           for update using (is_studio_staff(id));
create policy "staff manage modules"  on studio_modules    for all using (is_studio_staff(studio_id));
create policy "staff see staff"       on studio_staff      for select using (is_studio_staff(studio_id));
create policy "staff manage students" on studio_students   for all using (is_studio_staff(studio_id));
create policy "staff manage rooms"    on rooms             for all using (is_studio_staff(studio_id));
create policy "staff manage series"   on class_series      for all using (is_studio_staff(studio_id));
create policy "staff manage sessions" on class_sessions    for all using (is_studio_staff(studio_id));
create policy "staff manage plans"    on plans             for all using (is_studio_staff(studio_id));
create policy "staff see memberships" on memberships       for all using (is_studio_staff(studio_id));
create policy "staff see payments"    on payments          for select using (is_studio_staff(studio_id));
create policy "staff manage bookings" on bookings          for all using (is_studio_staff(studio_id));

-- Alumno: su perfil, sus abonos, sus pagos y sus reservas
create policy "own profile"           on profiles          for all using (user_id = auth.uid());
create policy "own student record"    on studio_students   for select using (user_id = auth.uid());
create policy "own memberships"       on memberships       for select using (user_id = auth.uid());
create policy "own membership series" on membership_series for select using (
  exists (select 1 from memberships m where m.id = membership_id and m.user_id = auth.uid()));
create policy "own payments"          on payments          for select using (user_id = auth.uid());
create policy "own bookings read"     on bookings          for select using (user_id = auth.uid());
-- Las reservas y pagos del alumno se crean desde el servidor (comprobando plazas y pago),
-- no directamente desde el navegador.
