-- Freedom: precios reales de su web (solo precios; no toca clases ni alumnos)
do $$
declare v_studio uuid;
begin
  select id into v_studio from studios where slug = 'freedom';
  if v_studio is null then raise exception 'Primero ejecuta seed_freedom.sql'; end if;
  delete from plans where studio_id = v_studio and kind = 'monthly_by_classes';
  insert into plans (studio_id, kind, name, price_cents, classes_per_week, class_count, sort) values
    (v_studio, 'monthly_by_classes', '1 clase por semana',  4000, 1,    null, 1),
    (v_studio, 'monthly_by_classes', '2 clases por semana', 6000, 2,    null, 2),
    (v_studio, 'monthly_by_classes', '3 clases por semana', 8500, 3,    null, 3),
    (v_studio, 'monthly_by_classes', '4 clases por semana', 9900, 4,    null, 4),
    (v_studio, 'monthly_by_classes', '5 clases por semana', 9900, 5,    null, 5),
    (v_studio, 'monthly_by_classes', 'Full pass',          11900, null, 6,    6);
  update studios set single_class_cents = 1200 where id = v_studio;
end $$;
