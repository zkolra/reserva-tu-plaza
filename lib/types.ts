export type DanceRole = "leader" | "follower" | "none";

export type Studio = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  cancel_hours: number;
};

export type ClassSeries = {
  id: string;
  name: string;
  level: string | null;
  teachers: string | null;
  weekday: number; // 1 = lunes … 7 = domingo
  start_time: string; // "19:00:00"
  duration_min: number;
  uses_roles: boolean;
  capacity: number | null;
  capacity_leaders: number | null;
  capacity_followers: number | null;
};

export type Plan = {
  id: string;
  kind: "trial" | "drop_in" | "monthly_by_classes" | "pack" | "subscription";
  name: string;
  price_cents: number;
  classes_per_week: number | null;
  class_count: number | null;
  sort: number;
};

export type Availability = {
  series_id: string;
  taken_total: number;
  taken_leaders: number;
  taken_followers: number;
};

export type StudioData = {
  studio: Studio;
  modules: Record<string, boolean>;
  series: ClassSeries[];
  plans: Plan[];
  availability: Record<string, Availability>;
  isDemo: boolean;
  /** Por qué se muestran datos de ejemplo en lugar de la base (para diagnosticar). */
  demoReason?: string;
};
