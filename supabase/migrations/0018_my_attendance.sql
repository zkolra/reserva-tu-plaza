-- El alumno ve su asistencia también cuando la escuela lo apuntó a mano
-- (filas con membership_id y sin user_id, de antes de que creara su cuenta).
drop policy if exists "own attendance via membership" on class_attendance;
create policy "own attendance via membership" on class_attendance for select
  using (membership_id in (select id from memberships where user_id = auth.uid()));
