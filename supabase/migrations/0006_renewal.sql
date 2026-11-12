-- Renovación del abono: automática (suscripción) o manual (cada mes se elige de nuevo).
-- El estudio decide qué permite: solo automática, solo manual o que elija el alumno.

alter table studios add column if not exists renewal_mode text not null default 'choice'
  check (renewal_mode in ('auto', 'manual', 'choice'));

alter table memberships add column if not exists auto_renew boolean not null default false;

-- Nueva versión de create_membership con la renovación elegida
drop function if exists create_membership(uuid, uuid[], dance_role);

create or replace function create_membership(p_studio uuid, p_series uuid[], p_role dance_role, p_auto_renew boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_n int := coalesce(array_length(p_series, 1), 0);
  v_mode text;
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

  select renewal_mode into v_mode from studios where id = p_studio;
  if v_mode is null then
    raise exception 'Estudio no encontrado';
  end if;
  v_auto := case v_mode when 'auto' then true when 'manual' then false else coalesce(p_auto_renew, false) end;

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

  -- Manual: válido un mes; automática: sin fecha de fin hasta que se cancele
  insert into memberships (studio_id, user_id, plan_id, status, starts_on, ends_on, auto_renew)
  values (
    p_studio, v_user, v_plan, 'active', current_date,
    case when v_auto then null else (current_date + interval '1 month')::date end,
    v_auto
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
