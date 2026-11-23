# Техническая структура

*Как устроена система и где что лежит. Секретные ключи здесь не записаны — только их названия и место.*

## Сервисы и аккаунты

| Сервис | Для чего | Где |
|---|---|---|
| GitHub | Код проекта | github.com/zkolra/reserva-tu-plaza |
| Cloudflare Workers | Сайт и система (каждое изменение в GitHub выкладывается само) | Worker «reserva-tu-plaza» → reserva-tu-plaza.zkolra.workers.dev |
| Cloudflare DNS | Домен dev22.es (куплен на Namecheap, DNS в Cloudflare) | dev22.es → DNS |
| Supabase | База данных, вход учеников и школ | Проект cwklgplnvfgzijvazhjn |
| Resend | Отправка писем с mail.dev22.es | resend.com, домен mail.dev22.es (Verified) |
| Supabase SMTP | Письма входа идут через Resend | Authentication → Emails → SMTP Settings |

## Ключи и переменные (Cloudflare → reserva-tu-plaza → Settings → Variables and Secrets)

| Название | Тип | Для чего |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Variable | Адрес базы |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Variable | Публичный ключ базы |
| RESEND_API_KEY | Secret | Отправка писем |
| CRON_SECRET | Secret | Ежедневные напоминания (тот же ключ в таблице app_secrets в Supabase) |
| VAPID_PRIVATE_KEY | Secret | Подпись push-уведомлений (публичная часть — в коде) |

## Как вносить изменения

- **Код**: меняется в GitHub → Cloudflare сам собирает и выкладывает за 2–3 минуты.
- **База данных**: SQL-файлы (миграции) по порядку — скопировать содержимое в Supabase → SQL Editor → Run. Почти все файлы можно безопасно запускать повторно.
- **Новая школа**: /superadmin или SQL-файл с расписанием (seed_*.sql).

## Ежедневные задачи в базе (pg_cron)

| Задача | Когда | Что делает |
|---|---|---|
| expire-memberships | Каждую ночь | Закрывает закончившиеся абонементы, сгорание матрикулы |
| renewal-reminders | Каждый день 9:00 (8:00 UTC) | Вызывает сайт /api/cron/reminders: письма и push «Tu abono termina…» |

## Устройство кода (коротко)

- **Next.js 16** (App Router) + Tailwind 4, собирается через OpenNext для Cloudflare.
- app/[slug] — страницы школы для учеников (расписание, cuenta, particulares), манифест приложения.
- app/admin/[slug] — админка школы; app/superadmin — суперадминка.
- app/api — письма (welcome, cancelled), напоминания (cron/reminders), тестовый push.
- lib — цены (pricing), письма (email), push, доступ к базе, темы и цвета.
- public/sw.js — service worker приложения (установка и push).
- supabase/migrations — все изменения базы по порядку; supabase/seed_*.sql — примеры школ.
- Безопасность: в базе включён Row Level Security — каждая школа видит только свои данные, ученик — только свои.

## SQL-миграции

| Файл | Что делает |
|---|---|
| 0001_init.sql | Reserva tu plaza — esquema inicial de la base de datos (Supabase / Postgres) Una sola base para todos los estudios: cada fila lleva studio_id y Row Level Security separ |
| 0002_series_availability.sql | Plazas ocupadas por clase semanal (abonos activos que la incluyen). Se ejecuta con permisos del propietario para que el widget público vea solo los números, nunca quié |
| 0003_grants.sql | Permisos de la API para la clave pública (anon) y los usuarios con sesión. Row Level Security sigue decidiendo qué filas ve cada uno.  |
| 0004_create_membership.sql | Guardar el abono de un alumno con las clases elegidas. Comprueba plazas por clase y rol dentro de la misma transacción (bloqueando esas clases) para que dos personas no  |
| 0005_admin.sql | Panel del estudio: lo que el equipo necesita leer además de lo que ya podía. Email del alumno en su perfil (auth.users no es accesible desde la API)  |
| 0006_renewal.sql | Renovación del abono: automática (suscripción) o manual (cada mes se elige de nuevo). El estudio decide qué permite: solo automática, solo manual o que elija el alum |
| 0007_enrollment_fee.sql | Matrícula: pago único al entrar en la escuela. Se paga con el primer abono. Sigue válida mientras el alumno tenga abono y caduca si pasa más de enrollment_valid_days  |
| 0008_trial_class.sql | Clase de prueba: una sola clase, una sola vez, solo para alumnos nuevos. Se reserva la próxima fecha de la clase elegida.  |
| 0009_branding.sql | Apariencia del estudio: color principal y logo.  |
| 0010_superadmin.sql | Superadmin de la plataforma: crear escuelas, dar acceso a sus dueños y entrar en el panel de cualquier escuela para ayudar a configurarla.  |
| 0011_private_lessons.sql | Clases particulares: profesores, opciones con precio, horario disponible, bloqueos, reservas (del alumno o hechas por la escuela) y bonos. Es el mismo motor que servirá  |
| 0012_student_account.sql | Cuenta del alumno: dejar de renovar el abono, volver a activarlo, cancelar clases particulares y de prueba según la política del estudio, y caducar los abonos que ya te |
| 0013_attendance.sql | Asistencia: quién está apuntado a cada clase de un día (abono, prueba, visitantes) y quién vino.  |
| 0014_private_slot_step.sql | Clases particulares: cada cuánto pueden empezar las clases y descanso entre clases. Ej.: clase de 50 min + 10 min de descanso, «según la duración» → 10:00, 11:00,  |
| 0015_manual_students.sql | 1) La escuela puede apuntar alumnos a mano (pagó en efectivo, no tiene cuenta todavía). 2) Asistencia: apuntar a alguien en días futuros y con rol; alumnos sin cuenta  |
| 0016_full_pass.sql | Full pass: el abono mensual sin número de clases (classes_per_week vacío). class_count del full pass = desde cuántas clases se aplica (vacío = solo cuando sale más b |
| 0017_contact_email.sql | Email de la escuela: las respuestas de los alumnos a nuestros correos llegan aquí.  |
| 0018_my_attendance.sql | El alumno ve su asistencia también cuando la escuela lo apuntó a mano (filas con membership_id y sin user_id, de antes de que creara su cuenta).  |
| 0019_cancellations.sql | Clases canceladas y días sin clase. · Una clase concreta: series_id + date_from = date_to   («el jueves no hay Salsa») · Toda la escuela cerrada: series_id vacío +  |
| 0020_paid_at_school.sql | Abono pagado en la escuela (efectivo, transferencia…): la fecha «pagado hasta» no se toca. El alumno solo elige cómo seguir al terminar: renovar con tarjeta (auto_re |
| 0021_calendar_month.sql | Abono por mes natural (del 1 al último día) y entrada a mitad de mes. · abono_period: 'calendar' = del 1 al último día · 'rolling' = un mes desde la compra (como an |
| 0022_renewals.sql | Pagos por periodo, renovación manual («Renovar diciembre») y recordatorios. · Cada abono tiene sus pagos: uno por periodo (mes). Pendiente → la escuela lo marca com |
| 0023_rsvp_test_mode.sql | «Voy / No voy» del alumno para una clase concreta, y modo prueba de la escuela.  |
| 0024_push.sql | Avisos push: cada dispositivo donde el alumno (o el profe) activa los avisos.  |

Дополнительно: seed.sql (демо-школа), seed_querico.sql (QueRico Dance), seed_freedom.sql и freedom_precios.sql (Freedom). Файл recordatorios_setup.sql с ключом в GitHub не хранится.
