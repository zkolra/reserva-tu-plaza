-- Email de la escuela: las respuestas de los alumnos a nuestros correos llegan aquí.
alter table studios add column if not exists contact_email text
  check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
