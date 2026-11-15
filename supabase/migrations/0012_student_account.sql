-- Cuenta del alumno: dejar de renovar el abono, volver a activarlo,
-- cancelar clases particulares y de prueba según la política del estudio,
-- y caducar los abonos que ya terminaron.

-- Abonos «mes a mes» o con la renovación cancelada pasan a caducados al terminar
create or replace function expire_memberships() returns int
language sql security definer set search_path = public as $$
  with x as (
    update memberships set status = 'expired'
    where status = 'active' and ends_on is not null and ends_on < current_date
    returning 1
  )
  select count(*)::int from x;
$$;

select expire_memberships();

-- Cada noche, si la extensión pg_cron está disponible (en Supabase lo está)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'expire-memberships';
  perform cron.schedule('expire-memberships', '5 0 * * *', 'select public.expire_memberships()');
exception when others then
  raise notice 'pg_cron no disponible (%): ejecuta select expire_memberships() de vez en cuando.', sqlerrm;
end $$;

-- Dejar de renovar: el abono sigue hasta el final del periodo pagado
create or replace function cancel_my_renewal(p_studio uuid) returns date
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_end date;
begin
  select * into m from memberships
  where studio_id = p_studio and user_id = auth.uid() and status = 'active'
  limit 1;
  if m.id is null then
    raise exception 'No tienes un abono activo';
  end if;
  if not m.auto_renew then
    return m.ends_on;
  end if;
  -- Fin del periodo actual: un mes después del inicio, el siguiente que aún no ha pasado
  v_end := m.starts_on;
  while v_end <= current_date loop
    v_end := (v_end + interval '1 month')::date;
  end loop;
  update memberships set auto_renew = false, ends_on = v_end where id = m.id;
  return v_end;
end;
$$;

-- Volver a activar la renovación automática (si el estudio la permite)
create or replace function resume_my_renewal(p_studio uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
begin
  select renewal_mode into v_mode from studios where id = p_studio;
  if v_mode = 'manual' then
    raise exception 'Esta escuela solo tiene pago mes a mes';
  end if;
  update memberships set auto_renew = true, ends_on = null
  where studio_id = p_studio and user_id = auth.uid() and status = 'active'
    and (ends_on is null or ends_on >= current_date);
  if not found then
    raise exception 'No tienes un abono activo';
  end if;
end;
$$;

-- Cancelar una clase particular propia, hasta N horas antes (política del estudio)
create or replace function cancel_my_private(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_hours int;
begin
  select * into b from private_bookings where id = p_booking and user_id = auth.uid();
  if b.id is null then
    raise exception 'Reserva no encontrada';
  end if;
  if b.status = 'cancelled' then
    return;
  end if;
  select cancel_hours into v_hours from studios where id = b.studio_id;
  if b.starts_at < now() + make_interval(hours => coalesce(v_hours, 12)) then
    raise exception 'Solo puedes cancelar hasta % horas antes. Escribe a la escuela.', coalesce(v_hours, 12);
  end if;
  update private_bookings set status = 'cancelled' where id = b.id;
end;
$$;

-- Cancelar la clase de prueba (se borra, así puede reservar otro día)
create or replace function cancel_my_trial(p_studio uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_hours int;
  v_tz text;
  v_start timestamptz;
begin
  select tb.*, cs.start_time into t
  from trial_bookings tb join class_series cs on cs.id = tb.series_id
  where tb.studio_id = p_studio and tb.user_id = auth.uid() and tb.status = 'booked';
  if t.id is null then
    raise exception 'No tienes una clase de prueba reservada';
  end if;
  select cancel_hours, coalesce(timezone, 'Europe/Madrid') into v_hours, v_tz from studios where id = p_studio;
  v_start := (t.class_date + t.start_time) at time zone v_tz;
  if v_start < now() + make_interval(hours => coalesce(v_hours, 12)) then
    raise exception 'Solo puedes cancelar hasta % horas antes. Escribe a la escuela.', coalesce(v_hours, 12);
  end if;
  delete from trial_bookings where id = t.id;
end;
$$;

revoke execute on function expire_memberships() from public, anon, authenticated;
revoke execute on function cancel_my_renewal(uuid) from public, anon;
revoke execute on function resume_my_renewal(uuid) from public, anon;
revoke execute on function cancel_my_private(uuid) from public, anon;
revoke execute on function cancel_my_trial(uuid) from public, anon;
grant execute on function cancel_my_renewal(uuid) to authenticated;
grant execute on function resume_my_renewal(uuid) to authenticated;
grant execute on function cancel_my_private(uuid) to authenticated;
grant execute on function cancel_my_trial(uuid) to authenticated;
