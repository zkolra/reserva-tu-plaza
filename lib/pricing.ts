import type { Availability, ClassSeries, DanceRole, Plan } from "./types";

export type Tier = { plan: Plan; label: string; minClasses: number };

/** Abono mensual según número de clases por semana.
 *  El plan sin número = Full pass (todas las clases que quieras).
 *  En el Full pass, class_count = desde cuántas clases se aplica (vacío: cuando sale más barato). */
export function monthlyTiers(plans: Plan[]): Tier[] {
  const monthly = plans
    .filter((p) => p.kind === "monthly_by_classes")
    .sort((a, b) => (a.classes_per_week ?? 999) - (b.classes_per_week ?? 999));
  const maxCounted = Math.max(0, ...monthly.map((p) => p.classes_per_week ?? 0));
  return monthly.map((plan) => ({
    plan,
    label:
      plan.classes_per_week === null
        ? `∞ ${plan.name || "Full pass"}`
        : plan.classes_per_week === 1
          ? "1 clase por semana"
          : `${plan.classes_per_week} clases por semana`,
    minClasses: plan.classes_per_week ?? plan.class_count ?? maxCounted + 1,
  }));
}

export const isFullPass = (t: Tier | null | undefined) => !!t && t.plan.classes_per_week === null;

/** El plan que corresponde a n clases elegidas (igual que pick_plan en la base de datos). */
export function tierFor(tiers: Tier[], n: number): Tier | null {
  if (n === 0 || tiers.length === 0) return null;
  const full = tiers
    .filter(isFullPass)
    .sort((a, b) => a.plan.price_cents - b.plan.price_cents)[0];
  const counted = tiers.filter((t) => !isFullPass(t));
  let tier = counted.find((t) => t.plan.classes_per_week === n) ?? null;
  if (!tier) {
    if (full) return full;
    tier = [...counted].reverse().find((t) => (t.plan.classes_per_week ?? 0) < n) ?? null;
  }
  if (
    full &&
    (!tier ||
      (full.plan.class_count !== null && n >= full.plan.class_count) ||
      tier.plan.price_cents >= full.plan.price_cents)
  )
    return full;
  return tier ?? counted[0] ?? null;
}

export function formatPrice(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Plazas libres para el rol elegido (en clases sin roles, plazas totales). */
export function freeSpots(s: ClassSeries, a: Availability | undefined, role: DanceRole) {
  const taken = a ?? { taken_total: 0, taken_leaders: 0, taken_followers: 0 };
  if (!s.uses_roles) return (s.capacity ?? 0) - taken.taken_total;
  if (role === "leader") return (s.capacity_leaders ?? 0) - taken.taken_leaders;
  return (s.capacity_followers ?? 0) - taken.taken_followers;
}

export function otherRoleSpots(s: ClassSeries, a: Availability | undefined, role: DanceRole) {
  return freeSpots(s, a, role === "leader" ? "follower" : "leader");
}
