"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { formatPrice } from "@/lib/pricing";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";
import LoginForm from "../LoginForm";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hhmm = (t: string) => t.slice(0, 5);
const ROLE_LABEL: Record<string, string> = { leader: "Leader", follower: "Follower", none: "—" };

type Studio = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  cancel_hours: number;
  renewal_mode: "auto" | "manual" | "choice";
  enrollment_fee_cents: number;
  enrollment_valid_days: number;
};
type Series = {
  id: string;
  name: string;
  level: string | null;
  teachers: string | null;
  weekday: number;
  start_time: string;
  duration_min: number;
  uses_roles: boolean;
  capacity: number | null;
  capacity_leaders: number | null;
  capacity_followers: number | null;
  active: boolean;
};
type Plan = {
  id: string;
  kind: string;
  name: string;
  price_cents: number;
  classes_per_week: number | null;
  active: boolean;
  sort: number;
};
type Taken = { series_id: string; taken_total: number; taken_leaders: number; taken_followers: number };
type Tab = "alumnos" | "clases" | "precios" | "ajustes";

export default function AdminStudio({ cfg, slug }: { cfg: SupabaseConfig; slug: string }) {
  const { sb, userId, email, ready } = useSession(cfg);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("alumnos");

  useEffect(() => {
    if (!sb || !userId) return;
    (async () => {
      const { data: s } = await sb.from("studios").select("id, name, slug, currency, cancel_hours, renewal_mode, enrollment_fee_cents, enrollment_valid_days").eq("slug", slug).maybeSingle();
      if (!s) {
        setAllowed(false);
        return;
      }
      const { data: staff } = await sb
        .from("studio_staff")
        .select("role")
        .eq("studio_id", s.id)
        .eq("user_id", userId)
        .maybeSingle();
      setStudio(s);
      setAllowed(!!staff);
    })();
  }, [sb, userId, slug]);

  if (!sb) return <p className="p-10">La base de datos no está conectada.</p>;
  if (!ready) return <p className="p-10 text-muted">Cargando…</p>;
  if (!email) return <LoginForm sb={sb} />;
  if (allowed === null) return <p className="p-10 text-muted">Cargando…</p>;
  if (!allowed || !studio)
    return (
      <main className="mx-auto max-w-md px-6 py-20">
        <h1 className="font-display text-2xl font-bold">Sin acceso</h1>
        <p className="mt-3 text-muted">
          {email} no forma parte del equipo de este estudio. <Link href="/admin" className="underline">Volver</Link>
        </p>
      </main>
    );

  const tabs: [Tab, string][] = [
    ["alumnos", "Alumnos"],
    ["clases", "Clases"],
    ["precios", "Precios"],
    ["ajustes", "Ajustes"],
  ];

  return (
    <div className="flex flex-1 flex-wrap">
      <nav aria-label="Menú del panel" className="flex max-w-full flex-[1_1_220px] flex-col gap-1 bg-ink p-4 text-white">
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-display text-sm font-bold">
            {studio.name.slice(0, 1)}
          </div>
          <div className="font-bold">{studio.name}</div>
        </div>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`flex h-11 items-center rounded-xl px-3 text-left text-sm ${
              tab === key ? "bg-white/15 font-bold" : "font-semibold text-white/75 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-2 px-2 pt-6 text-xs text-white/70">
          <Link href={`/${studio.slug}`} className="underline" target="_blank">
            Ver horario público ↗
          </Link>
          <span>{email}</span>
          <button type="button" className="w-fit underline" onClick={() => sb.auth.signOut()}>
            Salir
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-[999_1_560px] p-5 sm:p-8">
        {tab === "alumnos" && <Students sb={sb} studio={studio} />}
        {tab === "clases" && <Classes sb={sb} studio={studio} />}
        {tab === "precios" && <Prices sb={sb} studio={studio} />}
        {tab === "ajustes" && <Settings sb={sb} studio={studio} onSaved={setStudio} />}
      </main>
    </div>
  );
}

/* ───────────────────────── Alumnos ───────────────────────── */

type MembershipRow = {
  id: string;
  user_id: string;
  starts_on: string;
  auto_renew: boolean;
  ends_on: string | null;
  enrollment_fee_cents: number;
  plans: { name: string; price_cents: number } | null;
  membership_series: { role: string; class_series: { name: string; weekday: number; start_time: string } | null }[];
};

type TrialRow = {
  id: string;
  user_id: string;
  class_date: string;
  role: string;
  price_cents: number;
  class_series: { name: string; start_time: string } | null;
};

function Students({ sb, studio }: { sb: SupabaseClient; studio: Studio }) {
  const [rows, setRows] = useState<MembershipRow[] | null>(null);
  const [trials, setTrials] = useState<TrialRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("memberships")
        .select("id, user_id, starts_on, auto_renew, ends_on, enrollment_fee_cents, plans(name, price_cents), membership_series(role, class_series(name, weekday, start_time))")
        .eq("studio_id", studio.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) {
        setError(error.message);
        return;
      }
      const list = (data ?? []) as unknown as MembershipRow[];
      setRows(list);
      const { data: t } = await sb
        .from("trial_bookings")
        .select("id, user_id, class_date, role, price_cents, class_series(name, start_time)")
        .eq("studio_id", studio.id)
        .eq("status", "booked")
        .gte("class_date", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
        .order("class_date");
      const trialList = (t ?? []) as unknown as TrialRow[];
      setTrials(trialList);
      const ids = [...new Set([...list, ...trialList].map((r) => r.user_id))];
      if (ids.length) {
        const { data: profiles } = await sb.from("profiles").select("user_id, email, full_name").in("user_id", ids);
        setEmails(Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.full_name || p.email || "—"])));
      }
    })();
  }, [sb, studio.id]);

  const monthly = (rows ?? []).reduce((sum, r) => sum + (r.plans?.price_cents ?? 0), 0);

  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Alumnos con abono</h1>
      {error && <ErrorBox text={error} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Kpi label="Abonos activos" value={rows ? String(rows.length) : "…"} />
        <Kpi label="Ingresos al mes (previsto)" value={rows ? formatPrice(monthly, studio.currency) : "…"} />
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white p-4">
        {rows && rows.length === 0 ? (
          <p className="p-2 text-muted">Todavía nadie tiene abono. Comparte el enlace de tu horario con tus alumnos.</p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">Alumno</th>
                <th className="px-3 py-2 font-semibold">Clases</th>
                <th className="px-3 py-2 font-semibold">Rol</th>
                <th className="px-3 py-2 font-semibold">Abono</th>
                <th className="px-3 py-2 font-semibold">Pago</th>
                <th className="py-2 pl-3 text-right font-semibold">Precio / mes</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const role = r.membership_series.find((m) => m.role !== "none")?.role ?? "none";
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-3 pr-3 font-semibold">{emails[r.user_id] ?? "…"}</td>
                    <td className="px-3 py-3">
                      {r.membership_series.map((m, i) =>
                        m.class_series ? (
                          <div key={i}>
                            {m.class_series.name} · {DAYS.at(m.class_series.weekday - 1)} {hhmm(m.class_series.start_time)}
                          </div>
                        ) : null,
                      )}
                    </td>
                    <td className="px-3 py-3">{ROLE_LABEL[role]}</td>
                    <td className="px-3 py-3">{r.plans?.name}</td>
                    <td className="px-3 py-3">
                      {r.auto_renew
                        ? "Automático cada mes"
                        : r.ends_on
                          ? `Hasta el ${new Date(r.ends_on).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
                          : "Mes a mes"}
                    </td>
                    <td className="py-3 pl-3 text-right font-bold">
                      {r.plans ? formatPrice(r.plans.price_cents, studio.currency) : "—"}
                      {r.enrollment_fee_cents > 0 && (
                        <div className="text-xs font-semibold text-muted">
                          + matrícula {formatPrice(r.enrollment_fee_cents, studio.currency)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {trials.length > 0 && (
        <div className="rounded-2xl bg-white p-4">
          <h2 className="mb-2 text-base font-bold">Clases de prueba</h2>
          <ul className="flex flex-col">
            {trials.map((t) => (
              <li key={t.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2.5 text-sm">
                <span className="font-semibold">{emails[t.user_id] ?? "…"}</span>
                <span>
                  {t.class_series?.name} ·{" "}
                  {new Date(t.class_date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}{" "}
                  {t.class_series ? hhmm(t.class_series.start_time) : ""}
                  {t.role !== "none" ? ` · ${ROLE_LABEL[t.role]}` : ""}
                </span>
                <span className="font-bold">{formatPrice(t.price_cents, studio.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Clases ───────────────────────── */

const emptySeries = (): Omit<Series, "id"> => ({
  name: "",
  level: "",
  teachers: "",
  weekday: 1,
  start_time: "19:00",
  duration_min: 60,
  uses_roles: false,
  capacity: 12,
  capacity_leaders: 6,
  capacity_followers: 6,
  active: true,
});

function Classes({ sb, studio }: { sb: SupabaseClient; studio: Studio }) {
  const [list, setList] = useState<Series[] | null>(null);
  const [taken, setTaken] = useState<Record<string, Taken>>({});
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      sb
        .from("class_series")
        .select("id, name, level, teachers, weekday, start_time, duration_min, uses_roles, capacity, capacity_leaders, capacity_followers, active")
        .eq("studio_id", studio.id)
        .order("weekday")
        .order("start_time"),
      sb.rpc("series_availability", { p_studio: studio.id }),
    ]);
    if (s.error) setError(s.error.message);
    setList((s.data ?? []) as Series[]);
    setTaken(Object.fromEntries(((t.data ?? []) as Taken[]).map((x) => [x.series_id, x])));
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Omit<Series, "id">, id?: string) {
    setError(null);
    const row = {
      ...values,
      studio_id: studio.id,
      level: values.level || null,
      teachers: values.teachers || null,
      capacity: values.uses_roles ? null : values.capacity,
      capacity_leaders: values.uses_roles ? values.capacity_leaders : null,
      capacity_followers: values.uses_roles ? values.capacity_followers : null,
    };
    const res = id ? await sb.from("class_series").update(row).eq("id", id) : await sb.from("class_series").insert(row);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setEditing(null);
    load();
  }

  async function setActive(s: Series, active: boolean) {
    const res = await sb.from("class_series").update({ active }).eq("id", s.id);
    if (res.error) setError(res.error.message);
    load();
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Clases semanales</h1>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-white"
        >
          + Añadir clase
        </button>
      </div>
      {error && <ErrorBox text={error} />}
      {editing === "new" && <SeriesForm initial={emptySeries()} onSave={(v) => save(v)} onCancel={() => setEditing(null)} />}

      <div className="flex flex-col gap-2">
        {(list ?? []).map((s) =>
          editing === s.id ? (
            <SeriesForm
              key={s.id}
              initial={{ ...s, start_time: hhmm(s.start_time) }}
              onSave={(v) => save(v, s.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div
              key={s.id}
              className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white p-4 ${s.active ? "" : "opacity-55"}`}
            >
              <div className="w-36 shrink-0 text-sm font-bold">
                {DAYS.at(s.weekday - 1)} {hhmm(s.start_time)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {s.name} {!s.active && <span className="text-xs font-semibold text-muted">(desactivada)</span>}
                </div>
                <div className="text-xs text-muted">{[s.level, s.teachers].filter(Boolean).join(" · ")}</div>
              </div>
              <Occupancy s={s} t={taken[s.id]} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(s.id)} className="h-10 rounded-lg border border-line px-3 text-sm font-bold">
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setActive(s, !s.active)}
                  className="h-10 rounded-lg border border-line px-3 text-sm font-semibold text-muted"
                >
                  {s.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function Occupancy({ s, t }: { s: Series; t?: Taken }) {
  const bar = (taken: number, cap: number, label: string) => (
    <div className="flex items-center gap-2 text-xs font-semibold">
      <span className="w-16 text-muted">{label}</span>
      <span className="h-2 w-20 rounded-full bg-paper">
        <span
          className={`block h-2 rounded-full ${taken >= cap ? "bg-accent" : taken >= cap - 2 ? "bg-few" : "bg-ok"}`}
          style={{ width: `${cap ? Math.min(100, (taken / cap) * 100) : 0}%` }}
        />
      </span>
      {taken}/{cap}
    </div>
  );
  return (
    <div className="flex w-56 flex-col gap-1">
      {s.uses_roles ? (
        <>
          {bar(t?.taken_leaders ?? 0, s.capacity_leaders ?? 0, "Leaders")}
          {bar(t?.taken_followers ?? 0, s.capacity_followers ?? 0, "Followers")}
        </>
      ) : (
        bar(t?.taken_total ?? 0, s.capacity ?? 0, "Plazas")
      )}
    </div>
  );
}

function SeriesForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Omit<Series, "id">;
  onSave: (v: Omit<Series, "id">) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV({ ...v, [k]: val });
  const num = (x: string) => (x === "" ? null : Number(x));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 rounded-2xl border-2 border-ink bg-white p-4"
    >
      <Field label="Nombre de la clase">
        <input required value={v.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
      </Field>
      <Field label="Nivel">
        <input value={v.level ?? ""} onChange={(e) => set("level", e.target.value)} className={inputCls} />
      </Field>
      <Field label="Profes">
        <input value={v.teachers ?? ""} onChange={(e) => set("teachers", e.target.value)} className={inputCls} />
      </Field>
      <Field label="Día">
        <select value={v.weekday} onChange={(e) => set("weekday", Number(e.target.value))} className={inputCls}>
          {DAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hora">
        <input type="time" required value={hhmm(v.start_time)} onChange={(e) => set("start_time", e.target.value)} className={inputCls} />
      </Field>
      <Field label="Duración (min)">
        <input type="number" min={15} step={5} value={v.duration_min} onChange={(e) => set("duration_min", Number(e.target.value))} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
        <input type="checkbox" checked={v.uses_roles} onChange={(e) => set("uses_roles", e.target.checked)} className="h-5 w-5" />
        Plazas separadas Leader / Follower
      </label>
      {v.uses_roles ? (
        <>
          <Field label="Plazas leaders">
            <input type="number" min={1} required value={v.capacity_leaders ?? ""} onChange={(e) => set("capacity_leaders", num(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Plazas followers">
            <input type="number" min={1} required value={v.capacity_followers ?? ""} onChange={(e) => set("capacity_followers", num(e.target.value))} className={inputCls} />
          </Field>
        </>
      ) : (
        <Field label="Plazas">
          <input type="number" min={1} required value={v.capacity ?? ""} onChange={(e) => set("capacity", num(e.target.value))} className={inputCls} />
        </Field>
      )}
      <div className="col-span-full flex gap-2">
        <button type="submit" className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-white">
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────── Precios ───────────────────────── */

const KIND_LABEL: Record<string, string> = {
  trial: "Clase de prueba",
  drop_in: "Clase suelta",
  monthly_by_classes: "Abono mensual por nº de clases",
  pack: "Bono de clases",
  subscription: "Suscripción",
};
// Lo que se puede añadir ahora (la suscripción es una forma de renovar el abono, ver Ajustes)
const ADDABLE = ["trial", "monthly_by_classes"];

function Prices({ sb, studio }: { sb: SupabaseClient; studio: Studio }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb
      .from("plans")
      .select("id, kind, name, price_cents, classes_per_week, active, sort")
      .eq("studio_id", studio.id)
      .order("sort");
    if (error) setError(error.message);
    setPlans((data ?? []) as Plan[]);
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(p: Plan, patch: Partial<Plan>) {
    setError(null);
    const { error } = await sb.from("plans").update(patch).eq("id", p.id);
    if (error) setError(error.message);
    else {
      setSaved(p.id);
      setTimeout(() => setSaved(null), 1500);
    }
    load();
  }

  async function remove(p: Plan) {
    if (!window.confirm(`¿Eliminar «${p.name}»? No se puede deshacer.`)) return;
    setError(null);
    const { error } = await sb.from("plans").delete().eq("id", p.id);
    if (error) {
      setError(
        error.code === "23503"
          ? `«${p.name}» ya lo usa algún alumno, así que no se puede eliminar. Desactívalo para que no aparezca en la web.`
          : error.message,
      );
    }
    load();
  }

  async function add(kind: string) {
    const sort = Math.max(0, ...(plans ?? []).map((p) => p.sort)) + 1;
    const { error } = await sb.from("plans").insert({
      studio_id: studio.id,
      kind,
      name: KIND_LABEL[kind],
      price_cents: 0,
      classes_per_week: kind === "monthly_by_classes" ? 1 : null,
      class_count: kind === "trial" || kind === "drop_in" ? 1 : kind === "pack" ? 8 : null,
      sort,
    });
    if (error) setError(error.message);
    load();
  }

  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Precios y formas de pago</h1>
      <p className="max-w-2xl text-sm text-muted">
        Lo que está desactivado no aparece en tu web. En el abono mensual, deja «Clases por semana» vacío para el
        abono ilimitado.
      </p>
      {error && <ErrorBox text={error} />}
      <div className="flex flex-col gap-2">
        {(plans ?? []).map((p) => (
          <PlanRow
            key={p.id}
            plan={p}
            currency={studio.currency}
            saved={saved === p.id}
            onSave={(patch) => update(p, patch)}
            onDelete={() => remove(p)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {ADDABLE.map((kind) => (
          <button key={kind} type="button" onClick={() => add(kind)} className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
            + {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        La suscripción (cobro automático cada mes) se configura en Ajustes → Renovación del abono.
      </p>
    </section>
  );
}

function PlanRow({
  plan,
  currency,
  saved,
  onSave,
  onDelete,
}: {
  plan: Plan;
  currency: string;
  saved: boolean;
  onSave: (patch: Partial<Plan>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(String(plan.price_cents / 100));
  const [cpw, setCpw] = useState(plan.classes_per_week === null ? "" : String(plan.classes_per_week));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name,
          price_cents: Math.round(Number(price.replace(",", ".")) * 100),
          ...(plan.kind === "monthly_by_classes" ? { classes_per_week: cpw === "" ? null : Number(cpw) } : {}),
        });
      }}
      className={`flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ${plan.active ? "" : "opacity-55"}`}
    >
      <div className="flex w-full items-center justify-between text-xs font-bold text-muted">
        {KIND_LABEL[plan.kind]}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Eliminar ${plan.name}`}
          title="Eliminar"
          className="-my-2 flex h-9 w-9 items-center justify-center rounded-lg text-base text-muted hover:bg-accent-soft hover:text-accent"
        >
          ✕
        </button>
      </div>
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-56`} />
      </Field>
      {plan.kind === "monthly_by_classes" && (
        <Field label="Clases por semana">
          <input type="number" min={1} value={cpw} placeholder="ilimitado" onChange={(e) => setCpw(e.target.value)} className={`${inputCls} w-32`} />
        </Field>
      )}
      <Field label={`Precio (${currency})`}>
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputCls} w-28`} />
      </Field>
      <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
        {saved ? "Guardado ✓" : "Guardar"}
      </button>
      <button type="button" onClick={() => onSave({ active: !plan.active })} className="h-11 rounded-xl border border-line px-4 text-sm font-semibold">
        {plan.active ? "Desactivar" : "Activar"}
      </button>
      <span className="pb-3 text-sm text-muted">{formatPrice(plan.price_cents, currency)}</span>
    </form>
  );
}

/* ───────────────────────── Ajustes ───────────────────────── */

const RENEWAL: [Studio["renewal_mode"], string, string][] = [
  ["choice", "El alumno elige", "Al pagar, cada alumno decide: cada mes automáticamente o solo este mes."],
  ["auto", "Solo suscripción automática", "Se cobra cada mes con las mismas clases hasta que el alumno cancele."],
  ["manual", "Solo pago mes a mes", "El abono vale un mes; el alumno vuelve a elegir y pagar cada mes."],
];

const MODULES: [string, string, string][] = [
  ["roles", "Plazas separadas Leader / Follower", "Para clases en pareja: el grupo se mantiene equilibrado."],
  ["waitlist", "Lista de espera", "Cuando una clase está completa, los alumnos pueden apuntarse en espera."],
  ["payments", "Pagos online", "Los alumnos pagan al reservar (se activará con Stripe)."],
  ["room_rental", "Alquiler de salas", "Reservas de sala por horas (próximamente)."],
  ["online", "Clases online", "Enlace a la clase después de reservar (próximamente)."],
];

function Settings({ sb, studio, onSaved }: { sb: SupabaseClient; studio: Studio; onSaved: (s: Studio) => void }) {
  const [mods, setMods] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(studio.name);
  const [hours, setHours] = useState(String(studio.cancel_hours));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sb.from("studio_modules")
      .select("module, enabled")
      .eq("studio_id", studio.id)
      .then(({ data }) => setMods(Object.fromEntries((data ?? []).map((m) => [m.module, m.enabled]))));
  }, [sb, studio.id]);

  async function toggle(module: string) {
    const enabled = !mods[module];
    setMods({ ...mods, [module]: enabled });
    const { error } = await sb.from("studio_modules").upsert({ studio_id: studio.id, module, enabled });
    if (error) setError(error.message);
  }

  const [fee, setFee] = useState(String((studio.enrollment_fee_cents ?? 0) / 100));
  const [feeDays, setFeeDays] = useState(String(studio.enrollment_valid_days ?? 365));
  const [feeMsg, setFeeMsg] = useState<string | null>(null);
  async function saveFee(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const patch = {
      enrollment_fee_cents: Math.round(Number(fee.replace(",", ".") || 0) * 100),
      enrollment_valid_days: Number(feeDays) || 365,
    };
    const { error } = await sb.from("studios").update(patch).eq("id", studio.id);
    if (error) setError(error.message);
    else {
      onSaved({ ...studio, ...patch });
      setFeeMsg("Guardado ✓");
      setTimeout(() => setFeeMsg(null), 1500);
    }
  }

  const [renewal, setRenewal] = useState(studio.renewal_mode ?? "choice");
  async function saveRenewal(value: Studio["renewal_mode"]) {
    setRenewal(value);
    setError(null);
    const { error } = await sb.from("studios").update({ renewal_mode: value }).eq("id", studio.id);
    if (error) setError(error.message);
    else onSaved({ ...studio, renewal_mode: value });
  }

  async function saveStudio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const patch = { name, cancel_hours: Number(hours) };
    const { error } = await sb.from("studios").update(patch).eq("id", studio.id);
    if (error) setError(error.message);
    else {
      onSaved({ ...studio, ...patch });
      setMsg("Guardado ✓");
      setTimeout(() => setMsg(null), 1500);
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Ajustes</h1>
      {error && <ErrorBox text={error} />}

      <PasswordBox sb={sb} />

      <form onSubmit={saveStudio} className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-5">
        <Field label="Nombre del estudio">
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-64`} />
        </Field>
        <Field label="Cancelación gratis hasta (horas antes)">
          <input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className={`${inputCls} w-28`} />
        </Field>
        <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
          {msg ?? "Guardar"}
        </button>
      </form>

      <form onSubmit={saveFee} className="flex flex-col gap-3 rounded-2xl bg-white p-5">
        <div>
          <h2 className="text-base font-bold">Matrícula</h2>
          <p className="mt-1 text-sm text-muted">
            Pago único con el primer abono. Sigue válida mientras el alumno tenga abono; si pasa más tiempo del indicado
            sin abono, al volver la paga de nuevo. Pon 0 si no cobras matrícula.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Importe (${studio.currency})`}>
            <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={`${inputCls} w-28`} />
          </Field>
          <Field label="Caduca tras (días sin abono)">
            <input type="number" min={1} value={feeDays} onChange={(e) => setFeeDays(e.target.value)} className={`${inputCls} w-28`} />
          </Field>
          <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
            {feeMsg ?? "Guardar"}
          </button>
        </div>
      </form>

      <fieldset className="rounded-2xl bg-white p-5">
        <legend className="sr-only">Renovación del abono</legend>
        <h2 className="text-base font-bold">Renovación del abono</h2>
        <p className="mt-1 text-sm text-muted">Cómo pagan tus alumnos el abono mensual.</p>
        <div className="mt-3 flex flex-col gap-2">
          {RENEWAL.map(([value, title, help]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                renewal === value ? "border-2 border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="renewal_mode"
                checked={renewal === value}
                onChange={() => saveRenewal(value)}
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-bold">{title}</span>
                <span className="block text-xs text-muted">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-2xl bg-white p-5">
        <h2 className="text-base font-bold">Módulos del estudio</h2>
        <p className="mt-1 text-sm text-muted">Activa solo lo que necesitas; lo demás no aparece en tu web.</p>
        <div className="mt-3 flex flex-col">
          {MODULES.map(([key, label, help]) => (
            <div key={key} className="flex items-center justify-between gap-4 border-t border-line py-3">
              <div>
                <div className="text-sm font-bold">{label}</div>
                <div className="text-xs text-muted">{help}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!mods[key]}
                aria-label={label}
                onClick={() => toggle(key)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${mods[key] ? "bg-accent" : "bg-full"}`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${mods[key] ? "left-6" : "left-1"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PasswordBox({ sb }: { sb: SupabaseClient }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const { error } = await sb.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      setPassword("");
      setMsg("Contraseña guardada ✓ Ya puedes entrar con ella.");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <div>
        <h2 className="text-base font-bold">Tu contraseña</h2>
        <p className="mt-1 text-sm text-muted">
          Para entrar al panel con email y contraseña, sin esperar el enlace. Tu navegador puede guardarla.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nueva contraseña (mín. 8)">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} w-64`}
          />
        </Field>
        <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
          Guardar contraseña
        </button>
      </div>
      {msg && <p className="text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <ErrorBox text={error} />}
    </form>
  );
}

/* ───────────────────────── Piezas comunes ───────────────────────── */

const inputCls = "h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-ink";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-bold text-muted">
      {label}
      {children}
    </label>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">{text}</p>;
}
