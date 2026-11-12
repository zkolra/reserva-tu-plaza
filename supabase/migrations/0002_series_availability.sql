-- Plazas ocupadas por clase semanal (abonos activos que la incluyen).
-- Se ejecuta con permisos del propietario para que el widget público vea
-- solo los números, nunca quién está apuntado.
create or replace function series_availability(p_studio uuid)
returns table (series_id uuid, taken_total int, taken_leaders int, taken_followers int)
language sql stable security definer set search_path = public as $$
  select
    cs.id,
    count(ms.*)::int,
    count(ms.*) filter (where ms.role = 'leader')::int,
    count(ms.*) filter (where ms.role = 'follower')::int
  from class_series cs
  left join membership_series ms on ms.series_id = cs.id
  left join memberships m on m.id = ms.membership_id and m.status = 'active'
  where cs.studio_id = p_studio
    and (ms.membership_id is null or m.id is not null)
  group by cs.id;
$$;

grant execute on function series_availability(uuid) to anon, authenticated;
