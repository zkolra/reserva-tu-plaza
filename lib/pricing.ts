import type { Availability, ClassSeries, DanceRole, Plan } from "./types";

export type Tier = { plan: Plan; label: string; minClasses: number };

/** Abono mensual según número de clases por semana. El plan sin número = ilimitado. */
export function monthlyTiers(plans: Plan[]): Tier[] {
  const monthly = plans
    .filter((p) => p.kind === "monthly_by_classes")
    .sort((a, b) => (a.classes_per_week ?? 999) - (b.classes_per_week ?? 999));
  const maxCounted = Math.max(0, ...monthly.map((p) => p.classes_per_week ?? 0));
  return monthly.map((plan) => ({
    plan,
    label:
      plan.classes_per_week === null
        ? `${maxCounted + 1} o más (ilimitado)`
        : plan.classes_per_week === 1
          ? "1 clase por semana"
          : `${plan.classes_per_week} clases por semana`,
    minClasses: plan.classes_per_week ?? maxCounted + 1,
  }));
}

/** El plan que corresponde a n clases elegidas. */
export function tierFor(tiers: Tier[], n: number): Tier | null {
  if (n === 0 || tiers.length === 0) return null;
  const exact = tiers.find((t) => t.plan.classes_per_week === n);
  if (exact) return exact;
  const unlimited = tiers.find((t) => t.plan.classes_per_week === null);
  if (unlimited && n >= unlimited.minClasses) return unlimited;
  // Sin ilimitado: el plan más alto disponible
  return tiers.at(-1) ?? null;
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
