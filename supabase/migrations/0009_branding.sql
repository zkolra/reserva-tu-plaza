-- Apariencia del estudio: color principal y logo.

alter table studios add column if not exists accent_color text not null default '#b8235a'
  check (accent_color ~ '^#[0-9a-fA-F]{6}$');
alter table studios add column if not exists logo_url text;

-- Almacén público de logos: logos/<studio_id>/<archivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Cualquiera puede ver los logos (salen en la web pública)
drop policy if exists "logos public read" on storage.objects;
create policy "logos public read" on storage.objects
  for select using (bucket_id = 'logos');

-- Solo el equipo del estudio sube, cambia o borra su logo (carpeta = id del estudio)
drop policy if exists "logos staff insert" on storage.objects;
create policy "logos staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and public.is_studio_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "logos staff update" on storage.objects;
create policy "logos staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and public.is_studio_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "logos staff delete" on storage.objects;
create policy "logos staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and public.is_studio_staff(((storage.foldername(name))[1])::uuid));
