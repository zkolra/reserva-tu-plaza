-- Abono por mes natural (del 1 al último día) y entrada a mitad de mes.
--  · abono_period: 'calendar' = del 1 al último día · 'rolling' = un mes desde la compra (como antes)
--  · prorate_mode:  quien empieza a mitad de mes paga 'proportional' (precio × clases que quedan / clases del mes)
--                   o 'per_class' (precio de una clase × clases que quedan, como mucho el mes entero)
--  · next_month_from_day: desde ese día del mes se ofrece también «empezar el día 1 del mes siguiente»
-- Festivos y clases canceladas no cuentan como clases.

alter table studios add column if not exists abono_period text not null default 'calendar'
  check (abono_period in ('calendar', 'rolling'));
alter table studios add column if not exists prorate_mode text not null default 'proportional'
  check (prorate_mode in ('proportional', 'per_class'));
alter table studios add column if not exists single_class_cents int not null default 0 check (single_class_cents >= 0);
alter table studios add column if not exists next_month_from_day int check (next_month_from_day between 1 and 31);

alter table memberships add column if not exists period_cents int;     -- a pagar por el primer periodo
alter table memberships add column if not exists period_sessions int;  -- clases de ese primer periodo

-- Clases de una serie entre dos fechas (sin festivos ni cancelaciones)
create or replace function series_sessions(p_series uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from class_series s
  cross join generate_series(p_from, p_to, interval '1 day') d
  where s.id = p_series
    and extract(isodow from d) = s.weekday
    and d::date >= s.starts_on
    and (s.ends_on is null or d::date <= s.ends_on)
    and not is_class_cancelled(s.id, d::date);
$$;

-- Lo que costaría un abono con estas clases, empezando hoy (o el 1 del mes siguiente)
create or replace function quote_membership(p_studio uuid, p_series uuid[], p_start date default null)
returns table (
  plan_id uuid, plan_name text, monthly_cents int,
  start_on date, period_end date,
  sessions_total int, sessions_left int, first_cents int,
  offer_next boolean, next_start date, next_cents int
)
language plpgsql stable security definer set search_path = public as $$
declare
  s studios;
  v_today date;
  v_month date;
  v_next date;
  v_plan plans;
  v_total int := 0;
  v_left int := 0;
  v_first int;
  v_end date;
  x uuid;
begin
  select * into s from studios where id = p_studio;
  if s.id is null then
    raise exception 'Estudio no encontrado';
  end if;
  v_today := (now() at time zone coalesce(s.timezone, 'Europe/Madrid'))::date;
  v_next := (date_trunc('month', v_today) + interval '1 month')::date;
  if p_start is not null and p_start <> v_today and p_start <> v_next then
    raise exception 'Fecha de inicio no válida';
  end if;
  if p_start = v_next and s.abono_period <> 'calendar' then
    raise exception 'Fecha de inicio no válida';
  end if;
  start_on := coalesce(p_start, v_today);

  select * into v_plan from plans where id = pick_plan(p_studio, coalesce(array_length(p_series, 1), 0));
  plan_id := v_plan.id;
  plan_name := v_plan.name;
  monthly_cents := coalesce(v_plan.price_cents, 0);

  if s.abono_period = 'calendar' then
    v_month := date_trunc('month', start_on)::date;
    v_end := (v_month + interval '1 month' - interval '1 day')::date;
    foreach x in array coalesce(p_series, '{}') loop
      v_total := v_total + series_sessions(x, v_month, v_end);
      v_left := v_left + series_sessions(x, start_on, v_end);
    end loop;
    if start_on = v_month or v_left >= v_total then
      v_first := monthly_cents;
    elsif s.prorate_mode = 'per_class' and s.single_class_cents > 0 then
      v_first := least(monthly_cents, s.single_class_cents * v_left);
    elsif v_total > 0 then
      v_first := round(monthly_cents::numeric * v_left / v_total)::int;
    else
      v_first := 0;
    end if;
  else
    v_end := (start_on + interval '1 month')::date;
    v_first := monthly_cents;
    v_total := null;
    v_left := null;
  end if;

  period_end := v_end;
  sessions_total := v_total;
  sessions_left := v_left;
  first_cents := v_first;
  offer_next := s.abono_period = 'calendar' and p_start is null and s.next_month_from_day is not null
                and extract(day from v_today) >= s.next_month_from_day and start_on <> v_month;
  next_start := v_next;
  next_cents := monthly_cents;
  return next;
end;
$$;
grant execute on function quote_membership(uuid, uuid[], date) to anon, authenticated;
revoke execute on function series_sessions(uuid, date, date) from public, anon;

drop function if exists create_membership(uuid, uuid[], dance_role, boolean);
drop function if exists admin_create_membership(uuid, uuid[], dance_role, text, text, text, int, text, boolean);

create or replace function create_membership(p_studio uuid, p_series uuid[], p_role dance_role, p_auto_renew boolean, p_start date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_n int := coalesce(array_length(p_series, 1), 0);
  v_mode text;
  v_fee int;
  v_auto boolean;
  v_old uuid;
  v_plan uuid;
  v_membership uuid;
  v_role dance_role;
  v_taken int;
  v_cap int;
  r record;
  v_q record;
begin
  if v_user is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if v_n = 0 then
    raise exception 'Elige al menos una clase';
  end if;
  if p_role not in ('leader', 'follower') then
    raise exception 'Rol no válido';
  end if;

  select renewal_mode, enrollment_fee_cents into v_mode, v_fee from studios where id = p_studio;
  if v_mode is null then
    raise exception 'Estudio no encontrado';
  end if;
  v_auto := case v_mode when 'auto' then true when 'manual' then false else coalesce(p_auto_renew, false) end;
  -- Se calcula antes de tocar el abono anterior
  v_fee := case when enrollment_due_for(p_studio, v_user) then v_fee else 0 end;

  if (select count(*) from class_series where id = any(p_series) and studio_id = p_studio and active) <> v_n then
    raise exception 'Alguna clase ya no está disponible';
  end if;

  select id into v_old
  from memberships
  where studio_id = p_studio and user_id = v_user and status = 'active'
  limit 1;

  for r in
    select * from class_series
    where id = any(p_series) and studio_id = p_studio
    order by id
    for update
  loop
    v_role := case when r.uses_roles then p_role else 'none'::dance_role end;

    select count(*) into v_taken
    from membership_series ms
    join memberships m on m.id = ms.membership_id
    where ms.series_id = r.id
      and m.status = 'active'
      and (v_old is null or m.id <> v_old)
      and (not r.uses_roles or ms.role = v_role);

    v_cap := case
      when not r.uses_roles then r.capacity
      when v_role = 'leader' then r.capacity_leaders
      else r.capacity_followers
    end;

    if v_taken >= v_cap then
      raise exception 'La clase «%» ya no tiene plazas', r.name;
    end if;
  end loop;

  v_plan := pick_plan(p_studio, v_n);
  if v_plan is null then
    raise exception 'El estudio todavía no tiene abonos configurados';
  end if;

  select * into v_q from quote_membership(p_studio, p_series, p_start);

  if v_old is not null then
    update memberships set status = 'cancelled', ends_on = current_date where id = v_old;
  end if;

  insert into profiles (user_id) values (v_user) on conflict do nothing;
  insert into studio_students (studio_id, user_id, default_role)
  values (p_studio, v_user, p_role)
  on conflict (studio_id, user_id) do update set default_role = excluded.default_role;

  insert into memberships (studio_id, user_id, plan_id, status, starts_on, ends_on, auto_renew, enrollment_fee_cents,
                           period_cents, period_sessions)
  values (
    p_studio, v_user, v_plan, 'active', v_q.start_on,
    case when v_auto then null else v_q.period_end end,
    v_auto, v_fee,
    -- Al cambiar de clases a mitad de mes no se cobra otra vez el mes en curso
    case when v_old is null then v_q.first_cents end,
    v_q.sessions_left
  )
  returning id into v_membership;

  insert into membership_series (membership_id, series_id, role)
  select v_membership, cs.id, case when cs.uses_roles then p_role else 'none'::dance_role end
  from class_series cs
  where cs.id = any(p_series);

  return v_membership;
end;
$$;

create or replace function admin_create_membership(
  p_studio uuid, p_series uuid[], p_role dance_role, p_name text, p_email text, p_phone text,
  p_months int default 1, p_payment text default 'cash', p_enrollment boolean default false,
  p_start date default null
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
  v_q record;
  v_period text;
  v_end date;
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

  v_plan := pick_plan(p_studio, v_n);
  if v_plan is null then
    raise exception 'Primero crea los precios del abono en «Precios»';
  end if;

  if p_enrollment then
    select enrollment_fee_cents into v_fee from studios where id = p_studio;
  end if;

  select * into v_q from quote_membership(p_studio, p_series, p_start);
  select abono_period into v_period from studios where id = p_studio;
  v_end := case when v_period = 'calendar'
    then (date_trunc('month', v_q.start_on) + make_interval(months => p_months) - interval '1 day')::date
    else (v_q.start_on + make_interval(months => p_months))::date end;

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
    guest_name, guest_email, guest_phone, payment_method, created_by, period_cents, period_sessions
  ) values (
    p_studio, v_user, v_plan, 'active', v_q.start_on, v_end, false,
    coalesce(v_fee, 0), nullif(trim(p_name), ''), v_email, nullif(trim(coalesce(p_phone, '')), ''),
    coalesce(p_payment, 'cash'), auth.uid(),
    v_q.first_cents + v_q.monthly_cents * (p_months - 1), v_q.sessions_left
  ) returning id into v_id;

  insert into membership_series (membership_id, series_id, role)
  select v_id, cs.id, case when cs.uses_roles then p_role else 'none'::dance_role end
  from class_series cs where cs.id = any(p_series);

  return v_id;
end;
$$;

revoke execute on function create_membership(uuid, uuid[], dance_role, boolean, date) from public, anon;
grant execute on function create_membership(uuid, uuid[], dance_role, boolean, date) to authenticated;
revoke execute on function admin_create_membership(uuid, uuid[], dance_role, text, text, text, int, text, boolean, date) from public, anon;
grant execute on function admin_create_membership(uuid, uuid[], dance_role, text, text, text, int, text, boolean, date) to authenticated;
