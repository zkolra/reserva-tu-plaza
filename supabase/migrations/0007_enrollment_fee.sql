-- Matrícula: pago único al entrar en la escuela.
-- Se paga con el primer abono. Sigue válida mientras el alumno tenga abono
-- y caduca si pasa más de enrollment_valid_days sin abono; entonces se vuelve a pagar.

alter table studios add column if not exists enrollment_fee_cents int not null default 0 check (enrollment_fee_cents >= 0);
alter table studios add column if not exists enrollment_valid_days int not null default 365 check (enrollment_valid_days > 0);

-- Matrícula cobrada junto con cada abono (0 si no tocaba)
alter table memberships add column if not exists enrollment_fee_cents int not null default 0;

-- ¿Tiene que pagar matrícula este usuario en este estudio?
create or replace function enrollment_due_for(p_studio uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.enrollment_fee_cents > 0 from studios s where s.id = p_studio),
    false
  )
  and not exists (
    select 1
    from memberships m, studios s
    where s.id = p_studio
      and m.studio_id = p_studio
      and m.user_id = p_user
      and (
        m.status = 'active'
        or coalesce(m.ends_on, m.created_at::date) >= current_date - s.enrollment_valid_days
      )
  );
$$;

-- Versión para el alumno con sesión (la usa la web)
create or replace function enrollment_due(p_studio uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and enrollment_due_for(p_studio, auth.uid());
$$;

revoke execute on function enrollment_due_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function enrollment_due(uuid) from public, anon;
grant execute on function enrollment_due(uuid) to authenticated;

-- create_membership guarda también la matrícula que toca
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

  select id into v_plan from plans
  where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week = v_n;
  if v_plan is null then
    select id into v_plan from plans
    where studio_id = p_studio and active and kind = 'monthly_by_classes' and classes_per_week is null;
  end if;
  if v_plan is null then
    select id into v_plan from plans
    where studio_id = p_studio and active and kind = 'monthly_by_classes'
    order by classes_per_week desc limit 1;
  end if;
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

revoke execute on function create_membership(uuid, uuid[], dance_role, boolean) from public, anon;
grant execute on function create_membership(uuid, uuid[], dance_role, boolean) to authenticated;
