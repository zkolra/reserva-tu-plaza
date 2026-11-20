-- Abono pagado en la escuela (efectivo, transferencia…): la fecha «pagado hasta» no se toca.
-- El alumno solo elige cómo seguir al terminar: renovar con tarjeta (auto_renew) o pagar en la escuela.

create or replace function set_my_next_payment(p_studio uuid, p_card boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update memberships set auto_renew = p_card
  where studio_id = p_studio and user_id = auth.uid() and status = 'active'
    and payment_method <> 'online';
  if not found then
    raise exception 'No tienes un abono pagado en la escuela';
  end if;
end;
$$;
revoke execute on function set_my_next_payment(uuid, boolean) from public, anon;
grant execute on function set_my_next_payment(uuid, boolean) to authenticated;

-- Las funciones de renovación online ya no borran la fecha de un abono pagado en la escuela
create or replace function resume_my_renewal(p_studio uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
begin
  select renewal_mode into v_mode from studios where id = p_studio;
  if v_mode = 'manual' then
    raise exception 'Esta escuela solo tiene pago mes a mes';
  end if;
  update memberships
     set auto_renew = true,
         ends_on = case when payment_method = 'online' then null else ends_on end
  where studio_id = p_studio and user_id = auth.uid() and status = 'active'
    and (ends_on is null or ends_on >= current_date);
  if not found then
    raise exception 'No tienes un abono activo';
  end if;
end;
$$;

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
  if m.payment_method <> 'online' and m.ends_on is not null then
    update memberships set auto_renew = false where id = m.id;
    return m.ends_on;
  end if;
  v_end := m.starts_on;
  while v_end <= current_date loop
    v_end := (v_end + interval '1 month')::date;
  end loop;
  update memberships set auto_renew = false, ends_on = v_end where id = m.id;
  return v_end;
end;
$$;
