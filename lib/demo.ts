import type { Availability, ClassSeries, Plan, StudioData } from "./types";

// Datos de ejemplo: se usan mientras no hay base de datos conectada
// o cuando el estudio pedido es "demo" y aún no existe en Supabase.

type Row = [string, number, string, string, string, string, boolean, number, number, number, number];
// id, día, hora, nombre, nivel, profes, roles, cap (o cap leaders), cap followers, ocupadas (o leaders), ocupadas followers
const rows: Row[] = [
  ["c1", 1, "19:00", "Salsa en pareja", "Básico", "Ana y Diego", true, 6, 6, 5, 6],
  ["c2", 1, "20:00", "Salsa Footwork", "Intermedio", "Ana", false, 16, 0, 10, 0],
  ["c3", 1, "21:00", "Bachata sensual", "Abierto", "Lucía y Marco", true, 5, 5, 2, 5],
  ["c4", 2, "18:00", "Lady Style", "Básico", "Lucía", false, 14, 0, 14, 0],
  ["c5", 2, "19:00", "Salsa caleña", "Intermedio", "Diego y Ana", true, 6, 6, 6, 3],
  ["c6", 2, "20:00", "Rueda de casino", "Abierto", "Diego", true, 8, 8, 4, 5],
  ["c7", 3, "19:00", "Salsa en pareja", "Intermedio", "Ana y Diego", true, 6, 6, 3, 4],
  ["c8", 3, "20:00", "Kizomba", "Básico", "Marco y Lucía", true, 5, 5, 1, 4],
  ["c9", 3, "21:00", "Reggaetón", "Abierto", "Lucía", false, 20, 0, 12, 0],
  ["c10", 4, "18:00", "Salsa Footwork", "Básico", "Ana", false, 16, 0, 15, 0],
  ["c11", 4, "19:00", "Bachata en pareja", "Básico", "Lucía y Marco", true, 6, 6, 4, 6],
  ["c12", 4, "20:00", "Salsa Spicy", "Avanzado", "Ana", false, 14, 0, 6, 0],
  ["c13", 5, "19:00", "Son cubano", "Abierto", "Diego y Ana", true, 5, 5, 2, 2],
  ["c14", 5, "20:00", "Salsa en pareja", "Avanzado", "Ana y Diego", true, 6, 6, 2, 5],
];

const series: ClassSeries[] = rows.map(([id, weekday, time, name, level, teachers, roles, a, b]) => ({
  id,
  name,
  level,
  teachers,
  weekday,
  start_time: `${time}:00`,
  duration_min: 60,
  uses_roles: roles,
  capacity: roles ? null : a,
  capacity_leaders: roles ? a : null,
  capacity_followers: roles ? b : null,
}));

const availability: Record<string, Availability> = Object.fromEntries(
  rows.map(([id, , , , , , roles, , , x, y]) => [
    id,
    {
      series_id: id,
      taken_total: roles ? x + y : x,
      taken_leaders: roles ? x : 0,
      taken_followers: roles ? y : 0,
    },
  ]),
);

const plans: Plan[] = [
  { id: "p0", kind: "trial", name: "Clase de prueba", price_cents: 1000, classes_per_week: null, class_count: 1, sort: 0 },
  { id: "p1", kind: "monthly_by_classes", name: "1 clase por semana", price_cents: 3500, classes_per_week: 1, class_count: null, sort: 1 },
  { id: "p2", kind: "monthly_by_classes", name: "2 clases por semana", price_cents: 6000, classes_per_week: 2, class_count: null, sort: 2 },
  { id: "p3", kind: "monthly_by_classes", name: "3 clases por semana", price_cents: 8500, classes_per_week: 3, class_count: null, sort: 3 },
  { id: "p4", kind: "monthly_by_classes", name: "Ilimitado", price_cents: 10000, classes_per_week: null, class_count: null, sort: 4 },
];

export const demoData: StudioData = {
  studio: { id: "demo", name: "Estudio de baile (demo)", slug: "demo", currency: "EUR", cancel_hours: 12, renewal_mode: "choice", enrollment_fee_cents: 2000, enrollment_valid_days: 365 },
  modules: { classes: true, payments: true, roles: true, waitlist: true },
  series,
  plans,
  availability,
  isDemo: true,
};
