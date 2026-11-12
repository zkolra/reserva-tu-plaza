-- Panel del estudio: lo que el equipo necesita leer además de lo que ya podía.

-- Email del alumno en su perfil (auth.users no es accesible desde la API)
alter table profiles add column if not exists email text;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function handle_new_user();

-- Rellenar los perfiles de quien ya se registró
insert into profiles (user_id, email)
select id, email from auth.users
on conflict (user_id) do update set email = excluded.email;

-- El equipo ve los perfiles de sus alumnos
create policy "staff read student profiles" on profiles for select using (
  exists (select 1 from studio_students st where st.user_id = profiles.user_id and is_studio_staff(st.studio_id))
);

-- El equipo ve qué clases tiene cada abono de su estudio
create policy "staff read membership series" on membership_series for select using (
  exists (select 1 from memberships m where m.id = membership_id and is_studio_staff(m.studio_id))
);

-- Cada persona ve en qué estudios es parte del equipo
create policy "own staff rows" on studio_staff for select using (user_id = auth.uid());

revoke execute on function handle_new_user() from public, anon, authenticated;
