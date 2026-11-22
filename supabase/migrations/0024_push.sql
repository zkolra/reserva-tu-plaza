-- Avisos push: cada dispositivo donde el alumno (o el profe) activa los avisos.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "own push" on push_subscriptions;
create policy "own push" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on push_subscriptions to authenticated;

-- Dispositivos de los apuntados a una clase un día (solo para el personal de esa escuela)
create or replace function push_subs_for_class(p_series uuid, p_date date)
returns table (endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from class_series where id = p_series;
  if v_studio is null or not is_studio_staff(v_studio) then
    raise exception 'Sin permiso';
  end if;
  return query
  select distinct ps.endpoint, ps.p256dh, ps.auth
  from push_subscriptions ps
  where ps.user_id in (
    select m.user_id from memberships m
    join membership_series ms on ms.membership_id = m.id and ms.series_id = p_series
    where m.status = 'active' and m.user_id is not null
      and m.starts_on <= p_date and (m.ends_on is null or m.ends_on >= p_date)
    union
    select tb.user_id from trial_bookings tb
    where tb.series_id = p_series and tb.class_date = p_date and tb.status <> 'cancelled'
  );
end;
$$;
grant execute on function push_subs_for_class(uuid, date) to authenticated;

-- Dispositivos de unos abonos (para los recordatorios diarios, con la clave del cron)
create or replace function push_subs_for_memberships(p_secret text, p_ids uuid[])
returns table (membership_id uuid, endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select x.value from app_secrets x where x.name = 'cron') then
    raise exception 'Sin permiso';
  end if;
  return query
  select m.id, ps.endpoint, ps.p256dh, ps.auth
  from memberships m join push_subscriptions ps on ps.user_id = m.user_id
  where m.id = any(p_ids);
end;
$$;
grant execute on function push_subs_for_memberships(text, uuid[]) to anon, authenticated;

-- Quitar un dispositivo que ya no existe (el servicio de push responde 404/410)
create or replace function forget_push_sub(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;
grant execute on function forget_push_sub(text) to anon, authenticated;
