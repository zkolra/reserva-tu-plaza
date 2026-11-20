-- Pagos por periodo, renovación manual («Renovar diciembre») y recordatorios.
--  · Cada abono tiene sus pagos: uno por periodo (mes). Pendiente → la escuela lo marca como pagado.
--  · Renovar = alargar el abono un periodo + un pago pendiente.
--  · Recordatorio por email N días antes del final (studios.renewal_reminder_days).

alter table studios add column if not exists renewal_reminder_days int not null default 5
  check (renewal_reminder_days between 1 and 15);
alter table memberships add column if not exists reminded_for date;  -- ends_on del último recordatorio

create table if not exists membership_payments (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships(id) on delete cascade,
  studio_id uuid not null references studios(id) on delete cascade,
  period_start date not null,
  period_end date,
  amount_cents int not null default 0,
  method text not null default 'school' check (method in ('online', 'cash', 'transfer', 'other', 'school')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists membership_payments_studio_idx on membership_payments (studio_id, status);

alter table membership_payments enable row level security;
drop policy if exists "staff payments" on membership_payments;
create policy "staff payments" on membership_payments for all
  using (is_studio_staff(studio_id)) with check (is_studio_staff(studio_id));
drop policy if exists "own payments" on membership_payments;
create policy "own payments" on membership_payments for select
  using (membership_id in (select id from memberships where user_id = auth.uid()));
grant select on membership_payments to authenticated;
grant insert, update, delete on membership_payments to authenticated;

-- Al crear un abono se apunta su primer pago (en la escuela = pagado; por la web = pendiente hasta que haya pago online)
create or replace function membership_first_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.period_cents is null then
    return new;  -- cambio de clases a mitad de mes: no se cobra otra vez
  end if;
  insert into membership_payments (membership_id, studio_id, period_start, period_end, amount_cents, method, status, paid_at)
  values (
    new.id, new.studio_id, new.starts_on, new.ends_on,
    new.period_cents + coalesce(new.enrollment_fee_cents, 0),
    case when new.payment_method = 'online' then 'school' else new.payment_method end,
    case when new.payment_method = 'online' then 'pending' else 'paid' end,
    case when new.payment_method = 'online' then null else now() end
  );
  return new;
end;
$$;
drop trigger if exists memberships_first_payment on memberships;
create trigger memberships_first_payment after insert on memberships
  for each row execute function membership_first_payment();

-- El alumno renueva su abono un periodo más (pago en la escuela de momento)
create or replace function renew_my_membership(p_studio uuid) returns date
language plpgsql security definer set search_path = public as $$
declare
  m memberships;
  s studios;
  v_n int;
  v_plan plans;
  v_start date;
  v_end date;
begin
  select * into s from studios where id = p_studio;
  select * into m from memberships
  where studio_id = p_studio and user_id = auth.uid() and status = 'active'
  limit 1;
  if m.id is null then
    raise exception 'No tienes un abono activo';
  end if;
  if m.ends_on is null then
    raise exception 'Tu abono ya se renueva solo';
  end if;
  if m.ends_on > current_date + 15 then
    raise exception 'Todavía es pronto para renovar';
  end if;

  select count(*) into v_n from membership_series where membership_id = m.id;
  select * into v_plan from plans where id = pick_plan(p_studio, v_n);
  v_start := m.ends_on + 1;
  v_end := case when s.abono_period = 'calendar'
    then (date_trunc('month', v_start) + interval '1 month' - interval '1 day')::date
    else (v_start + interval '1 month')::date end;

  update memberships set ends_on = v_end, plan_id = coalesce(v_plan.id, plan_id) where id = m.id;
  insert into membership_payments (membership_id, studio_id, period_start, period_end, amount_cents, method, status)
  values (m.id, p_studio, v_start, v_end, coalesce(v_plan.price_cents, 0), 'school', 'pending');
  return v_end;
end;
$$;
revoke execute on function renew_my_membership(uuid) from public, anon;
grant execute on function renew_my_membership(uuid) to authenticated;

-- ── Recordatorios: los envía la web (/api/cron/reminders), que llama aquí con una clave ──
create table if not exists app_secrets (name text primary key, value text not null);
alter table app_secrets enable row level security;  -- sin políticas: nadie lo lee desde fuera
revoke all on app_secrets from anon, authenticated;

create or replace function due_renewal_reminders(p_secret text)
returns table (membership_id uuid, email text, name text, studio_name text, studio_slug text,
               accent_color text, logo_url text, contact_email text, ends_on date, price_cents int, classes text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select x.value from app_secrets x where x.name = 'cron') then
    raise exception 'Sin permiso';
  end if;
  return query
  select m.id,
         coalesce(u.email::text, p.email, m.guest_email),
         coalesce(p.full_name, m.guest_name),
         s.name, s.slug, s.accent_color, s.logo_url, s.contact_email,
         m.ends_on,
         pl.price_cents,
         (select string_agg(cs.name || ' · ' || to_char(cs.start_time, 'HH24:MI'), ', ' order by cs.weekday, cs.start_time)
            from membership_series ms join class_series cs on cs.id = ms.series_id where ms.membership_id = m.id)
  from memberships m
  join studios s on s.id = m.studio_id
  left join plans pl on pl.id = m.plan_id
  left join auth.users u on u.id = m.user_id
  left join profiles p on p.user_id = m.user_id
  where m.status = 'active'
    and m.ends_on is not null
    and (not m.auto_renew or m.payment_method <> 'online')
    and m.ends_on between current_date and current_date + s.renewal_reminder_days
    and (m.reminded_for is distinct from m.ends_on)
    and coalesce(u.email::text, p.email, m.guest_email) is not null;
end;
$$;

create or replace function mark_reminded(p_secret text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select x.value from app_secrets x where x.name = 'cron') then
    raise exception 'Sin permiso';
  end if;
  update memberships set reminded_for = ends_on where id = any(p_ids);
end;
$$;
grant execute on function due_renewal_reminders(text) to anon, authenticated;
grant execute on function mark_reminded(text, uuid[]) to anon, authenticated;
