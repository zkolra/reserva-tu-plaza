# Clases particulares — notas para retomar

Estado: **en pausa** (noviembre 2026). Primero se termina todo lo de clases en grupo.
La base de datos (migración 0011) y la primera versión de las pantallas ya existen y funcionan.

## Ya hecho

- Tablas: `teachers`, `private_options`, `teacher_availability`, `teacher_blocks`,
  `private_bookings`, `private_pack_plans` (migración 0011).
- Funciones: `private_slots` (huecos libres cada 30 min, todos los profesores de la opción
  disponibles, sin reservas ni bloqueos, a partir de 2 h), `book_private` (alumno),
  `admin_book_private` (la escuela apunta a alguien, puede salirse del horario disponible),
  `cancel_my_private` (alumno, hasta `cancel_hours` antes).
- Panel → «Clases particulares»: Reservas (confirmar, cancelar, apuntar a mano, bloquear horas),
  Horario disponible (cuadrícula por profesor, copiar a lunes–viernes), Opciones y precios,
  Bonos, Profesores, Ajustes (confirmar a mano, estilos).
- Página pública `/[slug]/particulares`: con quién → estilo y rol → día → hora libre → reservar con email.
- Online: enlace de Jitsi Meet generado al reservar.
- Ejemplo: `supabase/seed_querico.sql` (QueRico Dance: Gabriel, Sirine, Anaïs).

## Decisiones de la dueña del producto

- Reserva **inmediata** por defecto; casilla «confirmar cada reserva a mano» para quien quiera controlar.
- Cada profesor marca su horario disponible en una cuadrícula; puede **bloquear** días u horas concretas.
- La escuela puede **apuntar a alguien a mano** desde el panel (acuerdo por teléfono) y guardar su
  teléfono para recordatorios.
- Opciones por combinación de profesores con precio propio (p. ej. Solo Gabriel 60 €, Gabriel + Sirine 100 €).
- Bonos con duración que define la escuela.
- Cada profesor decide si da particulares o no.
- Es el mismo motor que después servirá para **alquiler de salas** (recurso = sala) y para
  **profesionales individuales** (yoga, vocal, entrenador personal).

## Pendiente

- Revisar con calma toda la experiencia (alumno y escuela) antes de enseñarla.
- Comprar y usar bonos (descontar clases, caducidad) — necesita pagos (Stripe).
- Pago al reservar.
- Recordatorios (email / push / SMS) usando el teléfono guardado.
- Reservas hechas por la escuela: avisar al alumno si dejó email.
- Que el profesor no pueda tener una particular a la misma hora que una clase en grupo suya
  (hoy los profesores de grupo son texto libre; unificar con `teachers`).
- Vista de calendario semanal de reservas en el panel.
- Antelación mínima configurable (hoy fija: 2 h).
- Hecho (0014): cada cuánto empiezan las clases (según la duración / 15 / 30 / 60 min) y descanso entre clases.
  La dueña prefiere flexibilidad (10:00 o 10:30); cada escuela lo elige en Ajustes.
- Alquiler de salas sobre este mismo motor.
