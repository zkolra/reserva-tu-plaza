-- Full pass: el abono mensual sin número de clases (classes_per_week vacío).
-- class_count del full pass = desde cuántas clases se aplica (vacío = solo cuando sale más barato).
-- Además, si contar clases sale igual o más caro que el full pass, se cobra el full pass.

create or replace function pick_plan(p_studio uuid, p_n int) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_tier plans;
  v_full plans;
begin
  select * into v_full from plans
  where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week is null
  order by price_cents limit 1;

  select * into v_tier from plans
  where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week = p_n
  limit 1;
  if v_tier.id is null then
    -- más clases de las que tienen precio: la opción más alta…
    select * into v_tier from plans
    where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week is not null
      and classes_per_week < p_n
    order by classes_per_week desc limit 1;
    -- …salvo que haya full pass, que entonces cubre el resto
    if v_full.id is not null then
      return v_full.id;
    end if;
  end if;

  if v_full.id is not null and (
       v_tier.id is null
       or (v_full.class_count is not null and p_n >= v_full.class_count)
       or v_tier.price_cents >= v_full.price_cents) then
    return v_full.id;
  end if;
  if v_tier.id is null then
    select * into v_tier from plans
    where studio_id = p_studio and active and kind = 'monthly_by_classes'
    order by classes_per_week limit 1;
  end if;
  return v_tier.id;
end;
$$;

revoke execute on function pick_plan(uuid, int) from public, anon;

create or replace function create_membership(p_studio uuid, p_series uuid[], p_role dance_role, p_auto_renew boolean)
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

  if v_old is not null then
    update memberships set status = 'cancelled', ends_on = current_date where id = v_old;
  end if;

  insert into profiles (user_id) values (v_user) on conflict do nothing;
  insert into studio_students (studio_id, user_id, default_role)
  values (p_studio, v_user, p_role)
  on conflict (studio_id, user_id) do update set default_role = excluded.default_role;

  insert into memberships (studio_id, user_id, plan_id, status, starts_on, ends_on, auto_renew, enrollment_fee_cents)
  values (
    p_studio, v_user, v_plan, 'active', current_date,
    case when v_auto then null else (current_date + interval '1 month')::date end,
    v_auto, v_fee
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

  v_plan := pick_plan(p_studio, v_n);
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
