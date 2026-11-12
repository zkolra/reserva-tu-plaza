-- Guardar el abono de un alumno con las clases elegidas.
-- Comprueba plazas por clase y rol dentro de la misma transacción
-- (bloqueando esas clases) para que dos personas no se queden con la última plaza.
-- Si el alumno ya tenía un abono activo en el estudio, se sustituye (= cambiar de clases).
-- Mientras no haya pagos online, el abono queda activo directamente.

create or replace function create_membership(p_studio uuid, p_series uuid[], p_role dance_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_n int := coalesce(array_length(p_series, 1), 0);
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

  -- Abono: el de exactamente N clases; si no existe, el ilimitado; si no, el más alto
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

  insert into memberships (studio_id, user_id, plan_id, status, starts_on)
  values (p_studio, v_user, v_plan, 'active', current_date)
  returning id into v_membership;

  insert into membership_series (membership_id, series_id, role)
  select v_membership, cs.id, case when cs.uses_roles then p_role else 'none'::dance_role end
  from class_series cs
  where cs.id = any(p_series);

  return v_membership;
end;
$$;

-- Solo usuarios con sesión (la migración 0003 da execute a anon por defecto)
revoke execute on function create_membership(uuid, uuid[], dance_role) from public, anon;
grant execute on function create_membership(uuid, uuid[], dance_role) to authenticated;
