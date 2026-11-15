-- Escuela de ejemplo «QueRico Dance» con clases particulares:
-- Gabriel, Sirine y Anaïs, opciones con precio, horario disponible y un bono.
-- Ejecutar en el SQL Editor de Supabase (después de las migraciones hasta la 0011).

do $$
declare
  v_studio uuid;
  v_gabriel uuid;
  v_sirine uuid;
  v_anais uuid;
  v_opt uuid;
begin
  insert into studios (name, slug, accent_color, private_styles)
  values ('QueRico Dance', 'querico', '#c2410c', array['Salsa', 'Bachata', 'Salsa caleña'])
  on conflict (slug) do update set name = excluded.name
  returning id into v_studio;

  insert into studio_modules (studio_id, module, enabled) values
    (v_studio, 'classes', true), (v_studio, 'payments', true), (v_studio, 'roles', true),
    (v_studio, 'waitlist', false), (v_studio, 'private', true)
  on conflict (studio_id, module) do update set enabled = excluded.enabled;

  -- Dueña de la escuela de ejemplo: zkolra@gmail.com
  insert into studio_staff (studio_id, user_id, role)
  select v_studio, id, 'owner' from auth.users where lower(email) = 'zkolra@gmail.com'
  on conflict do nothing;

  -- Precios del abono en grupo
  if not exists (select 1 from plans where studio_id = v_studio) then
    insert into plans (studio_id, kind, name, price_cents, classes_per_week, class_count, sort) values
      (v_studio, 'trial',              'Clase de prueba',     1000, null, 1,    0),
      (v_studio, 'monthly_by_classes', '1 clase por semana',  3500, 1,    null, 1),
      (v_studio, 'monthly_by_classes', '2 clases por semana', 6000, 2,    null, 2),
      (v_studio, 'monthly_by_classes', '3 clases por semana', 8500, 3,    null, 3);
  end if;

  -- Profesores (se vuelven a crear para que el ejemplo quede limpio)
  delete from teachers where studio_id = v_studio;
  insert into teachers (studio_id, name, sort) values (v_studio, 'Gabriel', 0) returning id into v_gabriel;
  insert into teachers (studio_id, name, sort) values (v_studio, 'Sirine', 1) returning id into v_sirine;
  insert into teachers (studio_id, name, sort) values (v_studio, 'Anaïs', 2) returning id into v_anais;

  -- Horario disponible para particulares
  insert into teacher_availability (studio_id, teacher_id, weekday, start_time, end_time)
  select v_studio, v_gabriel, d, t.s, t.e
  from generate_series(1, 5) d, (values (time '10:00', time '14:00'), (time '17:00', time '20:00')) t(s, e);
  insert into teacher_availability (studio_id, teacher_id, weekday, start_time, end_time) values
    (v_studio, v_sirine, 2, '10:00', '14:00'),
    (v_studio, v_sirine, 4, '10:00', '14:00'),
    (v_studio, v_sirine, 4, '17:00', '20:00'),
    (v_studio, v_sirine, 6, '11:00', '14:00'),
    (v_studio, v_anais, 1, '16:00', '20:00'),
    (v_studio, v_anais, 3, '16:00', '20:00'),
    (v_studio, v_anais, 5, '10:00', '13:00');

  -- Opciones con precio
  delete from private_options where studio_id = v_studio;
  insert into private_options (studio_id, name, teacher_ids, duration_min, price_cents, sort)
  values (v_studio, 'Solo Gabriel', array[v_gabriel], 60, 6000, 0) returning id into v_opt;
  insert into private_options (studio_id, name, teacher_ids, duration_min, price_cents, sort) values
    (v_studio, 'Gabriel + Sirine', array[v_gabriel, v_sirine], 60, 10000, 1),
    (v_studio, 'Gabriel + Anaïs', array[v_gabriel, v_anais], 60, 10000, 2);
  insert into private_options (studio_id, name, teacher_ids, duration_min, price_cents, online, sort) values
    (v_studio, 'Gabriel online', array[v_gabriel], 45, 4500, true, 3);

  delete from private_pack_plans where studio_id = v_studio;
  insert into private_pack_plans (studio_id, name, option_id, class_count, price_cents, valid_days) values
    (v_studio, 'Bono 4 clases con Gabriel', v_opt, 4, 21000, 90);
end $$;
