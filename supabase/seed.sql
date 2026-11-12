-- Estudio de ejemplo «demo» con horario semanal y precios.
-- Ejecutar después de las migraciones (SQL Editor de Supabase → Run).

with s as (
  insert into studios (name, slug, cancel_hours)
  values ('Estudio de baile (demo)', 'demo', 12)
  on conflict (slug) do update set name = excluded.name
  returning id
),
mods as (
  insert into studio_modules (studio_id, module, enabled)
  select s.id, m, true from s, unnest(array['classes', 'payments', 'roles', 'waitlist']) m
  on conflict do nothing
),
series as (
  insert into class_series
    (studio_id, name, level, teachers, weekday, start_time, uses_roles, capacity, capacity_leaders, capacity_followers)
  select s.id, v.name, v.level, v.teachers, v.weekday, v.t::time, v.roles, v.cap, v.cap_l, v.cap_f
  from s, (values
    ('Salsa en pareja',   'Básico',     'Ana y Diego',   1, '19:00', true,  null, 6, 6),
    ('Salsa Footwork',    'Intermedio', 'Ana',           1, '20:00', false, 16, null, null),
    ('Bachata sensual',   'Abierto',    'Lucía y Marco', 1, '21:00', true,  null, 5, 5),
    ('Lady Style',        'Básico',     'Lucía',         2, '18:00', false, 14, null, null),
    ('Salsa caleña',      'Intermedio', 'Diego y Ana',   2, '19:00', true,  null, 6, 6),
    ('Rueda de casino',   'Abierto',    'Diego',         2, '20:00', true,  null, 8, 8),
    ('Salsa en pareja',   'Intermedio', 'Ana y Diego',   3, '19:00', true,  null, 6, 6),
    ('Kizomba',           'Básico',     'Marco y Lucía', 3, '20:00', true,  null, 5, 5),
    ('Reggaetón',         'Abierto',    'Lucía',         3, '21:00', false, 20, null, null),
    ('Salsa Footwork',    'Básico',     'Ana',           4, '18:00', false, 16, null, null),
    ('Bachata en pareja', 'Básico',     'Lucía y Marco', 4, '19:00', true,  null, 6, 6),
    ('Salsa Spicy',       'Avanzado',   'Ana',           4, '20:00', false, 14, null, null),
    ('Son cubano',        'Abierto',    'Diego y Ana',   5, '19:00', true,  null, 5, 5),
    ('Salsa en pareja',   'Avanzado',   'Ana y Diego',   5, '20:00', true,  null, 6, 6)
  ) as v(name, level, teachers, weekday, t, roles, cap, cap_l, cap_f)
  returning id
)
insert into plans (studio_id, kind, name, price_cents, classes_per_week, class_count, sort)
select s.id, v.kind::plan_kind, v.name, v.price, v.cpw, v.cc, v.sort
from s, (values
  ('trial',              'Clase de prueba',     1000,  null::int, 1,         0),
  ('monthly_by_classes', '1 clase por semana',  3500,  1,         null::int, 1),
  ('monthly_by_classes', '2 clases por semana', 6000,  2,         null,      2),
  ('monthly_by_classes', '3 clases por semana', 8500,  3,         null,      3),
  ('monthly_by_classes', 'Ilimitado',           10000, null,      null,      4)
) as v(kind, name, price, cpw, cc, sort);
