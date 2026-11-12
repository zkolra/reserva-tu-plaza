-- Permisos de la API para la clave pública (anon) y los usuarios con sesión.
-- Row Level Security sigue decidiendo qué filas ve cada uno.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
