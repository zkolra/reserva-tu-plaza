-- Clases particulares: cada cuánto pueden empezar las clases y descanso entre clases.
-- Ej.: clase de 50 min + 10 min de descanso, «según la duración» → 10:00, 11:00, 12:00…

alter table studios add column if not exists private_slot_step int not null default 0
  check (private_slot_step in (0, 15, 30, 60));          -- 0 = según la duración (+ descanso)
alter table studios add column if not exists private_buffer_min int not null default 0
  check (private_buffer_min between 0 and 60);

create or replace function private_slots(p_option uuid, p_from date, p_days int default 14)
returns table (starts_at timestamptz, local_date date, local_time text)
language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  s record;
  v_tz text;
  v_n int;
  v_dur interval;
  v_buf interval;
  v_step_min int;
begin
  select * into o from private_options where id = p_option and active;
  if o.id is null then
    return;
  end if;
  select * into s from studios where id = o.studio_id;
  v_tz := coalesce(s.timezone, 'Europe/Madrid');
  v_n := cardinality(o.teacher_ids);
  v_dur := make_interval(mins => o.duration_min);
  v_buf := make_interval(mins => coalesce(s.private_buffer_min, 0));
  v_step_min := case when coalesce(s.private_slot_step, 0) = 0
                     then o.duration_min + coalesce(s.private_buffer_min, 0)
                     else s.private_slot_step end;

  return query
  with days as (
    select (p_from + i)::date as d
    from generate_series(0, least(greatest(p_days, 1), 62) - 1) i
  ),
  -- Inicios posibles: desde el comienzo de cada franja disponible, cada «paso»
  cand as (
    select distinct dd.d, (dd.d + a.start_time + k * make_interval(mins => v_step_min))::timestamp as ls
    from days dd
    join teacher_availability a
      on a.teacher_id = any(o.teacher_ids) and a.weekday = extract(isodow from dd.d)
    cross join lateral generate_series(
      0, floor(extract(epoch from (a.end_time - a.start_time)) / 60 / v_step_min)::int
    ) k
  ),
  ok as (
    select c.d, c.ls, (c.ls at time zone v_tz) as st
    from cand c
    where (c.ls + v_dur)::date = c.d
      and (
        select count(distinct a.teacher_id)
        from teacher_availability a
        join teachers te on te.id = a.teacher_id and te.active and te.offers_private
        where a.teacher_id = any(o.teacher_ids)
          and a.weekday = extract(isodow from c.d)
          and a.start_time <= c.ls::time
          and (c.ls + v_dur)::time <= a.end_time
      ) = v_n
  )
  select ok.st, ok.d, to_char(ok.ls, 'HH24:MI')
  from ok
  where ok.st > now() + interval '2 hours'
    -- el descanso se respeta antes y después de otras clases
    and not private_slot_taken(o.teacher_ids, ok.st - v_buf, ok.st + v_dur + v_buf)
  order by ok.st;
end;
$$;

grant execute on function private_slots(uuid, date, int) to anon, authenticated;
