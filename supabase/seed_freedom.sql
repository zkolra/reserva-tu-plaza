-- Escuela piloto «Freedom» (Barcelona) — horario del curso 2026-2027 según su portal de socios.
-- Ejecutar en el SQL Editor de Supabase (después de las migraciones hasta la 0023).
-- Por confirmar con la escuela: aforo de cada clase, profesores, precio de 1 clase y si hay Full pass.

do $$
declare
  v_studio uuid;
  v_glow uuid;
  v_vogue uuid;
begin
  insert into studios (name, slug, accent_color, enrollment_fee_cents, enrollment_valid_days, renewal_mode,
                       abono_period, test_mode, contact_email)
  values ('Freedom', 'freedom', '#7c3aed', 2000, 365, 'choice', 'calendar', true, 'zkolra@gmail.com')
  on conflict (slug) do update set name = excluded.name
  returning id into v_studio;

  insert into studio_modules (studio_id, module, enabled) values
    (v_studio, 'classes', true), (v_studio, 'payments', true), (v_studio, 'roles', true),
    (v_studio, 'waitlist', false), (v_studio, 'private', false)
  on conflict (studio_id, module) do update set enabled = excluded.enabled;

  insert into studio_staff (studio_id, user_id, role)
  select v_studio, id, 'owner' from auth.users where lower(email) = 'zkolra@gmail.com'
  on conflict do nothing;

  -- Salas
  delete from rooms where studio_id = v_studio;
  insert into rooms (studio_id, name) values (v_studio, 'Sala Glow') returning id into v_glow;
  insert into rooms (studio_id, name) values (v_studio, 'Sala Vogue') returning id into v_vogue;

  -- Precios conocidos: M2 60 €, M3 85 €, matrícula anual 20 €
  if not exists (select 1 from plans where studio_id = v_studio) then
    insert into plans (studio_id, kind, name, price_cents, classes_per_week, class_count, sort) values
      (v_studio, 'monthly_by_classes', '2 clases por semana', 6000, 2, null, 2),
      (v_studio, 'monthly_by_classes', '3 clases por semana', 8500, 3, null, 3);
  end if;

  -- Horario semanal (se vuelve a crear entero)
  delete from class_series where studio_id = v_studio;
  insert into class_series
    (studio_id, name, level, weekday, start_time, duration_min, room_id, uses_roles, capacity, capacity_leaders, capacity_followers)
  select v_studio, v.name, v.level, v.wd, v.t::time, v.dur, case v.room when 'G' then v_glow else v_vogue end,
         v.roles, case when v.roles then null else 20 end,
         case when v.roles then 10 end, case when v.roles then 10 end
  from (values
    -- Lunes
    ('Bachata',                        '0',   1, '19:00', 60, 'G', true),
    ('Salsa cubana',                   '0',   1, '20:00', 60, 'V', true),
    ('Dancehall',                      null,  1, '21:00', 60, 'G', false),
    -- Martes
    ('Comercial coreográfico',         null,  2, '19:00', 60, 'V', false),
    ('Bachata',                        '4',   2, '20:00', 60, 'G', true),
    ('Salsa cubana',                   '0.5', 2, '20:00', 60, 'V', true),
    ('Bachata',                        '0.5', 2, '21:00', 60, 'G', true),
    ('Reggaeton / Urbano',             null,  2, '21:00', 60, 'V', false),
    -- Miércoles
    ('Contemporáneo',                  null,  3, '19:00', 60, 'V', false),
    ('Salsa cubana',                   '1',   3, '19:00', 60, 'G', true),
    ('Afrobeats',                      null,  3, '20:00', 60, 'V', false),
    ('Bachata sensual · Movimiento corporal', null, 3, '20:00', 60, 'G', false),
    ('Queer Company',                  null,  3, '21:00', 90, 'G', false),
    ('Salsa On1',                      null,  3, '21:00', 60, 'V', true),
    -- Jueves
    ('Bachata',                        '0.5', 4, '19:00', 60, 'G', true),
    ('Yoga',                           null,  4, '19:00', 60, 'V', false),
    ('Bachata',                        '1',   4, '20:00', 60, 'G', true),
    ('Salsa cubana',                   '0.5', 4, '20:00', 60, 'V', true),
    ('Bachata',                        '0',   4, '21:00', 60, 'G', true),
    ('Salsa cubana',                   '1',   4, '21:00', 60, 'V', true),
    -- Viernes
    ('Salsa cubana',                   '0',   5, '20:00', 60, 'G', true),
    ('Bachata',                        '0',   5, '21:00', 60, 'G', true)
  ) as v(name, level, wd, t, dur, room, roles);
end $$;
