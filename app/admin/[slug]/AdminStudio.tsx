"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { formatPrice, isFullPass, monthlyTiers, tierFor } from "@/lib/pricing";
import type { Plan as PublicPlan } from "@/lib/types";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";
import LoginForm from "../LoginForm";
import PrivateLessons from "./PrivateLessons";
import Attendance from "./Attendance";
import StudioLogo from "@/components/StudioLogo";
import { THEME_PRESETS, contrast, themeVars } from "@/lib/theme";

const DAYS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const hhmm = (t: string) => t.slice(0, 5);
const ROLE_LABEL: Record<string, string> = {
  leader: "Leader",
  follower: "Follower",
  none: "—",
};

type Studio = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  cancel_hours: number;
  renewal_mode: "auto" | "manual" | "choice";
  enrollment_fee_cents: number;
  contact_email: string | null;
  enrollment_valid_days: number;
  accent_color: string;
  logo_url: string | null;
  timezone?: string | null;
};
type Room = { id: string; name: string };
type Series = {
  id: string;
  name: string;
  level: string | null;
  teachers: string | null;
  weekday: number;
  room_id: string | null;
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
  class_count: number | null;
  active: boolean;
  sort: number;
};
type Taken = {
  series_id: string;
  taken_total: number;
  taken_leaders: number;
  taken_followers: number;
};
type Tab = "asistencia" | "alumnos" | "clases" | "precios" | "particulares" | "apariencia" | "ajustes";

export default function AdminStudio({
  cfg,
  slug,
}: {
  cfg: SupabaseConfig;
  slug: string;
}) {
  const { sb, userId, email, ready } = useSession(cfg);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("asistencia");

  useEffect(() => {
    if (!sb || !userId) return;
    (async () => {
      const { data: s } = await sb
        .from("studios")
        .select(
          "id, name, slug, currency, cancel_hours, renewal_mode, enrollment_fee_cents, enrollment_valid_days, accent_color, logo_url, timezone",
        )
        .eq("slug", slug)
        .maybeSingle();
      if (!s) {
        setAllowed(false);
        return;
      }
      // contact_email llega con la migración 0017; sin ella, el panel sigue funcionando
      const { data: c } = await sb.from("studios").select("contact_email").eq("id", s.id).maybeSingle();
      (s as Studio).contact_email = (c as { contact_email?: string | null } | null)?.contact_email ?? null;
      // Equipo de la escuela o superadmin de la plataforma
      const { data: ok } = await sb.rpc("is_studio_staff", { sid: s.id });
      setStudio(s as Studio);
      setAllowed(!!ok);
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
          {email} no forma parte del equipo de este estudio.{" "}
          <Link href="/admin" className="underline">
            Volver
          </Link>
        </p>
      </main>
    );

  const tabs: [Tab, string][] = [
    ["asistencia", "Asistencia"],
    ["alumnos", "Alumnos"],
    ["clases", "Clases"],
    ["precios", "Precios"],
    ["particulares", "Clases particulares"],
    ["apariencia", "Apariencia"],
    ["ajustes", "Ajustes"],
  ];

  return (
    <div
      style={themeVars(studio.accent_color)}
      className="flex flex-1 flex-wrap"
    >
      <nav
        aria-label="Menú del panel"
        className="flex max-w-full flex-[1_1_220px] flex-col gap-1 bg-ink p-4 text-white"
      >
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-2">
          <StudioLogo name={studio.name} logoUrl={studio.logo_url} />
          <div className="font-bold">{studio.name}</div>
        </div>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`flex h-11 items-center rounded-xl px-3 text-left text-sm ${
              tab === key
                ? "bg-white/15 font-bold"
                : "font-semibold text-white/75 hover:text-white"
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
          <button
            type="button"
            className="w-fit underline"
            onClick={() => sb.auth.signOut()}
          >
            Salir
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-[999_1_560px] p-5 sm:p-8">
        {tab === "asistencia" && <Attendance sb={sb} studio={studio} />}
        {tab === "alumnos" && <Students sb={sb} studio={studio} />}
        {tab === "clases" && <Classes sb={sb} studio={studio} />}
        {tab === "precios" && <Prices sb={sb} studio={studio} />}
        {tab === "particulares" && <PrivateLessons sb={sb} studio={studio} />}
        {tab === "apariencia" && (
          <Appearance sb={sb} studio={studio} onSaved={setStudio} />
        )}
        {tab === "ajustes" && (
          <Settings sb={sb} studio={studio} onSaved={setStudio} />
        )}
      </main>
    </div>
  );
}

/* ───────────────────────── Alumnos ───────────────────────── */

type MembershipRow = {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  payment_method: string;
  starts_on: string;
  auto_renew: boolean;
  ends_on: string | null;
  enrollment_fee_cents: number;
  plans: { name: string; price_cents: number } | null;
  membership_series: {
    role: string;
    class_series: { name: string; weekday: number; start_time: string } | null;
  }[];
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
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  async function cancelMembership(r: MembershipRow, who: string) {
    if (!window.confirm(`¿Dar de baja a ${who}? Su abono termina hoy y su plaza queda libre.`)) return;
    const { error } = await sb
      .from("memberships")
      .update({ status: "cancelled", ends_on: new Date().toISOString().slice(0, 10), auto_renew: false })
      .eq("id", r.id);
    if (error) setError(error.message);
    setReload((n) => n + 1);
  }

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("memberships")
        .select(
          "id, user_id, guest_name, guest_email, guest_phone, payment_method, starts_on, auto_renew, ends_on, enrollment_fee_cents, plans(name, price_cents), membership_series(role, class_series(name, weekday, start_time))",
        )
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
        .select(
          "id, user_id, class_date, role, price_cents, class_series(name, start_time)",
        )
        .eq("studio_id", studio.id)
        .eq("status", "booked")
        .gte(
          "class_date",
          new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
        )
        .order("class_date");
      const trialList = (t ?? []) as unknown as TrialRow[];
      setTrials(trialList);
      const ids = [...new Set([...list, ...trialList].map((r) => r.user_id).filter((x): x is string => !!x))];
      if (ids.length) {
        const { data: profiles } = await sb
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", ids);
        setEmails(
          Object.fromEntries(
            (profiles ?? []).map((p) => [
              p.user_id,
              p.full_name || p.email || "—",
            ]),
          ),
        );
      }
    })();
  }, [sb, studio.id, reload]);

  const monthly = (rows ?? []).reduce(
    (sum, r) => sum + (r.plans?.price_cents ?? 0),
    0,
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Alumnos con abono</h1>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent">
            + Añadir alumno
          </button>
        )}
      </div>
      {error && <ErrorBox text={error} />}
      {notice && <p className="rounded-xl bg-ok-soft px-4 py-3 text-sm font-semibold text-ok-text">{notice}</p>}
      {adding && (
        <AddStudent
          sb={sb}
          studio={studio}
          onDone={(note) => {
            setAdding(false);
            setNotice(note);
            setReload((n) => n + 1);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Kpi label="Abonos activos" value={rows ? String(rows.length) : "…"} />
        <Kpi
          label="Ingresos al mes (previsto)"
          value={rows ? formatPrice(monthly, studio.currency) : "…"}
        />
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white p-4">
        {rows && rows.length === 0 ? (
          <p className="p-2 text-muted">
            Todavía nadie tiene abono. Comparte el enlace de tu horario con tus
            alumnos.
          </p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">Alumno</th>
                <th className="px-3 py-2 font-semibold">Clases</th>
                <th className="px-3 py-2 font-semibold">Rol</th>
                <th className="px-3 py-2 font-semibold">Abono</th>
                <th className="px-3 py-2 font-semibold">Pago</th>
                <th className="py-2 pl-3 text-right font-semibold">
                  Precio / mes
                </th>
                <th className="py-2 pl-3"></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const role =
                  r.membership_series.find((m) => m.role !== "none")?.role ??
                  "none";
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-3 pr-3 font-semibold">
                      {(r.user_id && emails[r.user_id]) || r.guest_name || r.guest_email || "…"}
                      {!r.user_id && (
                        <div className="text-xs font-normal text-muted">
                          {[r.guest_phone, r.guest_email].filter(Boolean).join(" · ") || "sin cuenta"}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.membership_series.map((m, i) =>
                        m.class_series ? (
                          <div key={i}>
                            {m.class_series.name} ·{" "}
                            {DAYS.at(m.class_series.weekday - 1)}{" "}
                            {hhmm(m.class_series.start_time)}
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
                      {PAYMENT_LABEL[r.payment_method] && (
                        <div className="text-xs text-muted">{PAYMENT_LABEL[r.payment_method]}</div>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right font-bold">
                      {r.plans
                        ? formatPrice(r.plans.price_cents, studio.currency)
                        : "—"}
                      {r.enrollment_fee_cents > 0 && (
                        <div className="text-xs font-semibold text-muted">
                          + matrícula{" "}
                          {formatPrice(r.enrollment_fee_cents, studio.currency)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => cancelMembership(r, (r.user_id && emails[r.user_id]) || r.guest_name || "este alumno")}
                        className="whitespace-nowrap text-xs text-muted underline hover:text-accent-text"
                      >
                        Dar de baja
                      </button>
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
              <li
                key={t.id}
                className="flex flex-wrap justify-between gap-2 border-t border-line py-2.5 text-sm"
              >
                <span className="font-semibold">
                  {(t.user_id && emails[t.user_id]) || "…"}
                </span>
                <span>
                  {t.class_series?.name} ·{" "}
                  {new Date(t.class_date + "T12:00:00").toLocaleDateString(
                    "es-ES",
                    { weekday: "short", day: "numeric", month: "short" },
                  )}{" "}
                  {t.class_series ? hhmm(t.class_series.start_time) : ""}
                  {t.role !== "none" ? ` · ${ROLE_LABEL[t.role]}` : ""}
                </span>
                <span className="font-bold">
                  {formatPrice(t.price_cents, studio.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const PAYMENT_LABEL: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", other: "Otro pago" };

function AddStudent({
  sb,
  studio,
  onDone,
  onCancel,
}: {
  sb: SupabaseClient;
  studio: Studio;
  onDone: (note: string | null) => void;
  onCancel: () => void;
}) {
  const [series, setSeries] = useState<Series[]>([]);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [role, setRole] = useState("none");
  const [months, setMonths] = useState(1);
  const [payment, setPayment] = useState("cash");
  const [enrollment, setEnrollment] = useState(studio.enrollment_fee_cents > 0);
  const [welcome, setWelcome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      sb
        .from("class_series")
        .select("id, name, level, teachers, weekday, room_id, start_time, duration_min, uses_roles, capacity, capacity_leaders, capacity_followers, active")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .order("weekday")
        .order("start_time"),
      sb.from("plans").select("id, kind, name, price_cents, classes_per_week, class_count, sort").eq("studio_id", studio.id).eq("kind", "monthly_by_classes").eq("active", true),
    ]).then(([s, p]) => {
      setSeries((s.data ?? []) as Series[]);
      setPlans((p.data ?? []) as PublicPlan[]);
    });
  }, [sb, studio.id]);

  const needsRole = series.some((x) => picked.includes(x.id) && x.uses_roles);
  const n = picked.length;
  const tier = tierFor(monthlyTiers(plans), n);
  const plan = tier?.plan;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (n === 0) {
      setError("Elige al menos una clase.");
      return;
    }
    if (needsRole && role === "none") {
      setError("Elige Leader o Follower.");
      return;
    }
    setBusy(true);
    const { data: membershipId, error } = await sb.rpc("admin_create_membership", {
      p_studio: studio.id,
      p_series: picked,
      p_role: needsRole ? role : "none",
      p_name: name,
      p_email: email,
      p_phone: phone,
      p_months: months,
      p_payment: payment,
      p_enrollment: enrollment,
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    let note: string | null = null;
    if (email.trim() && welcome) {
      const { data: s } = await sb.auth.getSession();
      const r = await fetch("/api/emails/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
        body: JSON.stringify({ membership: membershipId }),
      })
        .then((x) => x.json() as Promise<{ sent: boolean; reason?: string }>)
        .catch(() => ({ sent: false, reason: "network" }));
      note = r.sent
        ? `Le hemos enviado un email a ${email.trim()}.`
        : r.reason === "not_configured"
          ? "Alumno añadido. El email de bienvenida se enviará cuando estén activados los correos."
          : "Alumno añadido, pero no se pudo enviar el email.";
    }
    setBusy(false);
    onDone(note);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border-2 border-ink bg-white p-5">
      <div>
        <h2 className="text-lg font-bold">Añadir alumno</h2>
        <p className="text-sm text-muted">
          Para quien paga en la escuela. Si pones su email, cuando entre en la web verá su abono en «Mi cuenta».
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <Field label="Nombre">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email (opcional)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Teléfono (opcional)">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold text-muted">Clases</div>
        {series.length === 0 ? (
          <p className="text-sm text-muted">Primero crea las clases en «Clases».</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {series.map((x) => {
              const on = picked.includes(x.id);
              return (
                <label
                  key={x.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm ${on ? "border-2 border-ink" : "border-line"}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="block font-semibold">{x.name}</span>
                    <span className="block text-xs text-muted">
                      {DAYS.at(x.weekday - 1)} {hhmm(x.start_time)}
                      {x.level ? ` · ${x.level}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {needsRole && (
          <Field label="Rol">
            <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} w-40`}>
              <option value="none">Elige…</option>
              <option value="leader">Leader</option>
              <option value="follower">Follower</option>
            </select>
          </Field>
        )}
        <Field label="Pagado por">
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={`${inputCls} w-36`}>
            {[1, 2, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "1 mes" : `${m} meses`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Forma de pago">
          <select value={payment} onChange={(e) => setPayment(e.target.value)} className={`${inputCls} w-40`}>
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
            <option value="other">Otro</option>
          </select>
        </Field>
        {studio.enrollment_fee_cents > 0 && (
          <label className="flex h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={enrollment} onChange={(e) => setEnrollment(e.target.checked)} className="h-5 w-5" />
            Pagó la matrícula ({formatPrice(studio.enrollment_fee_cents, studio.currency)})
          </label>
        )}
      </div>

      {n > 0 && plan && (
        <p className="text-sm">
          {isFullPass(tier) ? `${plan.name} (todas las clases)` : `Abono de ${n} ${n === 1 ? "clase" : "clases"} por semana`}: <b>{formatPrice(plan.price_cents, studio.currency)}</b> al mes
          {months > 1 ? ` · ${formatPrice(plan.price_cents * months, studio.currency)} por ${months} meses` : ""}
        </p>
      )}
      {email.trim() && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={welcome} onChange={(e) => setWelcome(e.target.checked)} className="h-5 w-5" />
          Enviarle un email de bienvenida con sus clases y el enlace a «Mi cuenta»
        </label>
      )}
      {error && <ErrorBox text={error} />}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent disabled:opacity-40">
          {busy ? "Guardando…" : "Añadir alumno"}
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────── Clases ───────────────────────── */

const emptySeries = (): Omit<Series, "id"> => ({
  name: "",
  level: "",
  teachers: "",
  weekday: 1,
  room_id: null,
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
  const [rolesEnabled, setRolesEnabled] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);

  const load = useCallback(async () => {
    const [s, t, m, r] = await Promise.all([
      sb
        .from("class_series")
        .select(
          "id, name, level, teachers, weekday, room_id, start_time, duration_min, uses_roles, capacity, capacity_leaders, capacity_followers, active",
        )
        .eq("studio_id", studio.id)
        .order("weekday")
        .order("start_time"),
      sb.rpc("series_availability", { p_studio: studio.id }),
      sb
        .from("studio_modules")
        .select("enabled")
        .eq("studio_id", studio.id)
        .eq("module", "roles")
        .maybeSingle(),
      sb
        .from("rooms")
        .select("id, name")
        .eq("studio_id", studio.id)
        .order("name"),
    ]);
    setRooms((r.data ?? []) as Room[]);
    setRolesEnabled(!!m.data?.enabled);
    if (s.error) setError(s.error.message);
    setList((s.data ?? []) as Series[]);
    setTaken(
      Object.fromEntries(
        ((t.data ?? []) as Taken[]).map((x) => [x.series_id, x]),
      ),
    );
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Omit<Series, "id">, id?: string) {
    setError(null);
    // Dos clases a la vez en la misma sala no pueden coincidir
    if (values.room_id && values.active) {
      const toMin = (t: string) =>
        Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const a0 = toMin(values.start_time);
      const a1 = a0 + values.duration_min;
      const clash = (list ?? []).find(
        (c) =>
          c.id !== id &&
          c.active &&
          c.room_id === values.room_id &&
          c.weekday === values.weekday &&
          toMin(c.start_time) < a1 &&
          a0 < toMin(c.start_time) + c.duration_min,
      );
      if (clash) {
        const room =
          rooms.find((x) => x.id === values.room_id)?.name ?? "esa sala";
        setError(
          `En ${room} ya hay «${clash.name}» a las ${hhmm(clash.start_time)} ese día. Elige otra sala u otra hora.`,
        );
        return;
      }
    }
    const row = {
      ...values,
      studio_id: studio.id,
      level: values.level || null,
      teachers: values.teachers || null,
      capacity: values.uses_roles ? null : values.capacity,
      capacity_leaders: values.uses_roles ? values.capacity_leaders : null,
      capacity_followers: values.uses_roles ? values.capacity_followers : null,
    };
    const res = id
      ? await sb.from("class_series").update(row).eq("id", id)
      : await sb.from("class_series").insert(row);
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
        <h1 className="font-display text-2xl font-bold sm:text-3xl">
          Clases semanales
        </h1>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent"
        >
          + Añadir clase
        </button>
      </div>
      <RoomsBox sb={sb} studio={studio} rooms={rooms} onChanged={load} />
      {error && <ErrorBox text={error} />}
      {editing === "new" && (
        <SeriesForm
          initial={{
            ...emptySeries(),
            room_id: rooms.length === 1 ? rooms[0].id : null,
          }}
          rooms={rooms}
          rolesEnabled={rolesEnabled}
          onSave={(v) => save(v)}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="flex flex-col gap-2">
        {(list ?? []).map((s) =>
          editing === s.id ? (
            <SeriesForm
              key={s.id}
              initial={{ ...s, start_time: hhmm(s.start_time) }}
              rolesEnabled={rolesEnabled}
              rooms={rooms}
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
                  {s.name}{" "}
                  {!s.active && (
                    <span className="text-xs font-semibold text-muted">
                      (desactivada)
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {[
                    rooms.find((r) => r.id === s.room_id)?.name,
                    s.level,
                    s.teachers,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Occupancy s={s} t={taken[s.id]} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(s.id)}
                  className="h-10 rounded-lg border border-line px-3 text-sm font-bold"
                >
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

function RoomsBox({
  sb,
  studio,
  rooms,
  onChanged,
}: {
  sb: SupabaseClient;
  studio: Studio;
  rooms: Room[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim() || `Sala ${rooms.length + 1}`;
    setError(null);
    const { error } = await sb
      .from("rooms")
      .insert({ studio_id: studio.id, name: n });
    if (error) setError(error.message);
    setName("");
    onChanged();
  }

  async function rename(r: Room, next: string) {
    if (!next.trim() || next === r.name) return;
    const { error } = await sb
      .from("rooms")
      .update({ name: next.trim() })
      .eq("id", r.id);
    if (error) setError(error.message);
    onChanged();
  }

  async function remove(r: Room) {
    if (
      !window.confirm(
        `¿Eliminar «${r.name}»? Sus clases se quedan, pero sin sala.`,
      )
    )
      return;
    const { error } = await sb.from("rooms").delete().eq("id", r.id);
    if (error) setError(error.message);
    onChanged();
  }

  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Salas</h2>
        <span className="text-xs text-muted">
          {rooms.length === 0
            ? "Sin salas: todas las clases van en un solo horario."
            : rooms.length === 1
              ? "1 sala"
              : `${rooms.length} salas: puede haber varias clases a la misma hora.`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rooms.map((r) => (
          <span
            key={r.id}
            className="flex items-center gap-1 rounded-xl border border-line py-1 pl-1 pr-1"
          >
            <input
              defaultValue={r.name}
              aria-label="Nombre de la sala"
              onBlur={(e) => rename(r, e.target.value)}
              className="h-9 w-32 rounded-lg px-2 text-sm font-semibold outline-none focus:bg-paper"
            />
            <button
              type="button"
              onClick={() => remove(r)}
              aria-label={`Eliminar ${r.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent-text"
            >
              ✕
            </button>
          </span>
        ))}
        <form onSubmit={add} className="flex items-center gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Sala ${rooms.length + 1}`}
            aria-label="Nueva sala"
            className="h-11 w-36 rounded-xl border border-line px-3 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            className="h-11 rounded-xl border border-line px-3 text-sm font-bold"
          >
            + Añadir sala
          </button>
        </form>
      </div>
      {error && (
        <p className="mt-2 text-sm font-semibold text-accent-text">{error}</p>
      )}
    </div>
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
  rolesEnabled,
  rooms,
  onSave,
  onCancel,
}: {
  initial: Omit<Series, "id">;
  rolesEnabled: boolean;
  rooms: Room[];
  onSave: (v: Omit<Series, "id">) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) =>
    setV({ ...v, [k]: val });
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
        <input
          required
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Nivel">
        <input
          value={v.level ?? ""}
          onChange={(e) => set("level", e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Profes">
        <input
          value={v.teachers ?? ""}
          onChange={(e) => set("teachers", e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Día">
        <select
          value={v.weekday}
          onChange={(e) => set("weekday", Number(e.target.value))}
          className={inputCls}
        >
          {DAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hora">
        <input
          type="time"
          required
          value={hhmm(v.start_time)}
          onChange={(e) => set("start_time", e.target.value)}
          className={inputCls}
        />
      </Field>
      {rooms.length > 0 && (
        <Field label="Sala">
          <select
            value={v.room_id ?? ""}
            onChange={(e) => set("room_id", e.target.value || null)}
            className={inputCls}
          >
            <option value="">Sin sala</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Duración (min)">
        <input
          type="number"
          min={15}
          step={5}
          value={v.duration_min}
          onChange={(e) => set("duration_min", Number(e.target.value))}
          className={inputCls}
        />
      </Field>
      {(rolesEnabled || v.uses_roles) && (
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={v.uses_roles}
            onChange={(e) => set("uses_roles", e.target.checked)}
            className="h-5 w-5"
          />
          Plazas separadas Leader / Follower
        </label>
      )}
      {v.uses_roles ? (
        <>
          <Field label="Plazas leaders">
            <input
              type="number"
              min={1}
              required
              value={v.capacity_leaders ?? ""}
              onChange={(e) => set("capacity_leaders", num(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Plazas followers">
            <input
              type="number"
              min={1}
              required
              value={v.capacity_followers ?? ""}
              onChange={(e) => set("capacity_followers", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </>
      ) : (
        <Field label="Plazas">
          <input
            type="number"
            min={1}
            required
            value={v.capacity ?? ""}
            onChange={(e) => set("capacity", num(e.target.value))}
            className={inputCls}
          />
        </Field>
      )}
      <div className="col-span-full flex gap-2">
        <button
          type="submit"
          className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border border-line px-5 text-sm font-bold"
        >
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

function Prices({ sb, studio }: { sb: SupabaseClient; studio: Studio }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb
      .from("plans")
      .select("id, kind, name, price_cents, classes_per_week, class_count, active, sort")
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
      class_count:
        kind === "trial" || kind === "drop_in" ? 1 : kind === "pack" ? 8 : null,
      sort,
    });
    if (error) setError(error.message);
    load();
  }

  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">
        Precios y formas de pago
      </h1>
      <p className="max-w-2xl text-sm text-muted">
        Lo que está desactivado no aparece en tu web.
      </p>
      {error && <ErrorBox text={error} />}

      <h2 className="mt-2 text-lg font-bold">Clase de prueba</h2>
      <p className="-mt-3 max-w-2xl text-sm text-muted">
        Una sola clase, una vez, solo para alumnos nuevos. Si está activa, en tu
        horario aparece «Clase de prueba».
      </p>
      <div className="flex flex-col gap-2">
        {(plans ?? [])
          .filter((p) => p.kind === "trial")
          .map((p) => (
            <PlanRow
              key={p.id}
              plan={p}
              currency={studio.currency}
              saved={saved === p.id}
              onSave={(patch) => update(p, patch)}
              onDelete={() => remove(p)}
            />
          ))}
        {plans && !plans.some((p) => p.kind === "trial") && (
          <button
            type="button"
            onClick={() => add("trial")}
            className="h-11 w-fit rounded-xl border border-line bg-white px-4 text-sm font-semibold"
          >
            + Ofrecer clase de prueba
          </button>
        )}
      </div>

      <h2 className="mt-2 text-lg font-bold">Abono mensual</h2>
      <p className="-mt-3 max-w-2xl text-sm text-muted">
        El precio según cuántas clases por semana elige el alumno.
      </p>
      <div className="flex flex-col gap-2">
        {(plans ?? [])
          .filter((p) => p.kind !== "trial" && !(p.kind === "monthly_by_classes" && p.classes_per_week === null))
          .map((p) => (
            <PlanRow
              key={p.id}
              plan={p}
              currency={studio.currency}
              saved={saved === p.id}
              onSave={(patch) => update(p, patch)}
              onDelete={() => remove(p)}
            />
          ))}
        <button
          type="button"
          onClick={() => add("monthly_by_classes")}
          className="h-11 w-fit rounded-xl border border-line bg-white px-4 text-sm font-semibold"
        >
          + Añadir opción de abono
        </button>
      </div>

      <h2 className="mt-2 text-lg font-bold">∞ Full pass</h2>
      {plans && <FullPassBox key={plans.map((p) => p.id + p.price_cents + p.active).join()} sb={sb} studio={studio} />}
      <p className="text-xs text-muted">
        La suscripción (cobro automático cada mes) se configura en Ajustes →
        Renovación del abono.
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
  const [cpw, setCpw] = useState(
    plan.classes_per_week === null ? "" : String(plan.classes_per_week),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name,
          price_cents: Math.round(Number(price.replace(",", ".")) * 100),
          ...(plan.kind === "monthly_by_classes"
            ? { classes_per_week: cpw === "" ? null : Number(cpw) }
            : {}),
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
          className="-my-2 flex h-9 w-9 items-center justify-center rounded-lg text-base text-muted hover:bg-accent-soft hover:text-accent-text"
        >
          ✕
        </button>
      </div>
      <Field label="Nombre">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputCls} w-56`}
        />
      </Field>
      {plan.kind === "monthly_by_classes" && (
        <Field label="Clases por semana">
          <input
            type="number"
            min={1}
            required
            value={cpw}
            onChange={(e) => setCpw(e.target.value)}
            className={`${inputCls} w-32`}
          />
        </Field>
      )}
      <Field label={`Precio (${currency})`}>
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={`${inputCls} w-28`}
        />
      </Field>
      <button
        type="submit"
        className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white"
      >
        {saved ? "Guardado ✓" : "Guardar"}
      </button>
      <button
        type="button"
        onClick={() => onSave({ active: !plan.active })}
        className="h-11 rounded-xl border border-line px-4 text-sm font-semibold"
      >
        {plan.active ? "Desactivar" : "Activar"}
      </button>
      <span className="pb-3 text-sm text-muted">
        {formatPrice(plan.price_cents, currency)}
      </span>
    </form>
  );
}

/** Full pass = abono mensual sin número de clases (classes_per_week vacío).
 *  class_count = desde cuántas clases se aplica; vacío = cuando sale igual o más barato que contar clases. */
function FullPassBox({ sb, studio }: { sb: SupabaseClient; studio: Studio }) {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [name, setName] = useState("Full pass");
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("plans")
      .select("id, kind, name, price_cents, classes_per_week, class_count, active, sort")
      .eq("studio_id", studio.id)
      .eq("kind", "monthly_by_classes")
      .is("classes_per_week", null)
      .order("sort")
      .limit(1);
    const p = (data?.[0] as Plan | undefined) ?? null;
    setPlan(p);
    if (p) {
      setName(p.name);
      setPrice(p.price_cents ? String(p.price_cents / 100) : "");
      setFrom(p.class_count ? String(p.class_count) : "");
    }
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  const on = !!plan?.active;

  async function setOn(value: boolean) {
    setError(null);
    if (plan) {
      const { error } = await sb.from("plans").update({ active: value }).eq("id", plan.id);
      if (error) setError(error.message);
    } else if (value) {
      const { error } = await sb.from("plans").insert({
        studio_id: studio.id,
        kind: "monthly_by_classes",
        name: "Full pass",
        price_cents: 0,
        classes_per_week: null,
        class_count: null,
        sort: 99,
      });
      if (error) setError(error.message);
    }
    load();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setError(null);
    const { error } = await sb
      .from("plans")
      .update({
        name: name.trim() || "Full pass",
        price_cents: Math.round(Number(price.replace(",", ".") || 0) * 100),
        class_count: from === "" ? null : Number(from),
      })
      .eq("id", plan.id);
    if (error) setError(error.message);
    else {
      setMsg("Guardado ✓");
      setTimeout(() => setMsg(null), 1500);
    }
    load();
  }

  if (plan === undefined) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <p className="text-sm text-muted">
        Un precio fijo al mes y el alumno va a todas las clases que quiera. Al elegir clases en tu web, el precio pasa
        solo al Full pass cuando llega al número de clases que indiques o cuando sale más barato que pagar por clases.
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="¿Ofreces Full pass?">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={on === v}
            onClick={() => on !== v && setOn(v)}
            className={`h-11 rounded-xl px-5 text-sm font-bold ${on === v ? "bg-ink text-white" : "border border-line"}`}
          >
            {v ? "Sí, tenemos Full pass" : "No"}
          </button>
        ))}
      </div>
      {on && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-44`} />
          </Field>
          <Field label="Clases por semana">
            <span
              className="flex h-11 w-24 items-center justify-center rounded-xl border border-line bg-paper text-2xl"
              title="Todas las que quiera"
            >
              ∞
            </span>
          </Field>
          <Field label={`Precio al mes (${studio.currency})`}>
            <input
              required
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} w-28`}
            />
          </Field>
          <Field label="Se aplica desde (clases)">
            <input
              type="number"
              min={1}
              value={from}
              placeholder="automático"
              onChange={(e) => setFrom(e.target.value)}
              className={`${inputCls} w-36`}
            />
          </Field>
          <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
            {msg ?? "Guardar"}
          </button>
        </form>
      )}
      {on && plan && plan.price_cents === 0 && (
        <p className="text-sm font-semibold text-accent-text">Pon el precio del Full pass.</p>
      )}
      {error && <ErrorBox text={error} />}
    </div>
  );
}

/* ───────────────────────── Ajustes ───────────────────────── */

const RENEWAL: [Studio["renewal_mode"], string, string][] = [
  [
    "choice",
    "El alumno elige",
    "Al pagar, cada alumno decide: cada mes automáticamente o solo este mes.",
  ],
  [
    "auto",
    "Solo suscripción automática",
    "Se cobra cada mes con las mismas clases hasta que el alumno cancele.",
  ],
  [
    "manual",
    "Solo pago mes a mes",
    "El abono vale un mes; el alumno vuelve a elegir y pagar cada mes.",
  ],
];

const COMING_SOON = ["room_rental", "online", "payments"];

const MODULES: [string, string, string][] = [
  [
    "roles",
    "Plazas separadas Leader / Follower",
    "Para clases en pareja: el grupo se mantiene equilibrado.",
  ],
  [
    "waitlist",
    "Lista de espera",
    "Cuando una clase está completa, los alumnos pueden apuntarse en espera.",
  ],
  [
    "payments",
    "Pagos online",
    "Los alumnos pagan al reservar (se activará con Stripe).",
  ],
  [
    "room_rental",
    "Alquiler de salas",
    "Personas de fuera reservan y pagan una sala por horas.",
  ],
  [
    "online",
    "Clases online",
    "Clases por videollamada: el enlace llega después de reservar.",
  ],
];

function Settings({
  sb,
  studio,
  onSaved,
}: {
  sb: SupabaseClient;
  studio: Studio;
  onSaved: (s: Studio) => void;
}) {
  const [mods, setMods] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(studio.name);
  const [contact, setContact] = useState(studio.contact_email ?? "");
  const [hours, setHours] = useState(String(studio.cancel_hours));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sb.from("studio_modules")
      .select("module, enabled")
      .eq("studio_id", studio.id)
      .then(({ data }) =>
        setMods(
          Object.fromEntries((data ?? []).map((m) => [m.module, m.enabled])),
        ),
      );
  }, [sb, studio.id]);

  async function toggle(module: string) {
    const enabled = !mods[module];
    setMods({ ...mods, [module]: enabled });
    const { error } = await sb
      .from("studio_modules")
      .upsert({ studio_id: studio.id, module, enabled });
    if (error) setError(error.message);
  }

  const [fee, setFee] = useState(
    String((studio.enrollment_fee_cents ?? 0) / 100),
  );
  const [feeDays, setFeeDays] = useState(
    String(studio.enrollment_valid_days ?? 365),
  );
  const [feeMsg, setFeeMsg] = useState<string | null>(null);
  async function saveFee(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const patch = {
      enrollment_fee_cents: Math.round(
        Number(fee.replace(",", ".") || 0) * 100,
      ),
      enrollment_valid_days: Number(feeDays) || 365,
    };
    const { error } = await sb
      .from("studios")
      .update(patch)
      .eq("id", studio.id);
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
    const { error } = await sb
      .from("studios")
      .update({ renewal_mode: value })
      .eq("id", studio.id);
    if (error) setError(error.message);
    else onSaved({ ...studio, renewal_mode: value });
  }

  async function saveStudio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const patch = {
      name,
      cancel_hours: Number(hours),
      ...((contact.trim() || null) !== studio.contact_email ? { contact_email: contact.trim() || null } : {}),
    };
    const { error } = await sb
      .from("studios")
      .update(patch)
      .eq("id", studio.id);
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

      <form
        onSubmit={saveStudio}
        className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-5"
      >
        <Field label="Nombre del estudio">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputCls} w-64`}
          />
        </Field>
        <Field label="Email de la escuela (aquí llegan las respuestas)">
          <input
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="hola@tuescuela.com"
            className={`${inputCls} w-72`}
          />
        </Field>
        <Field label="Cancelación gratis hasta (horas antes)">
          <input
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={`${inputCls} w-28`}
          />
        </Field>
        <button
          type="submit"
          className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white"
        >
          {msg ?? "Guardar"}
        </button>
      </form>

      <form
        onSubmit={saveFee}
        className="flex flex-col gap-3 rounded-2xl bg-white p-5"
      >
        <div>
          <h2 className="text-base font-bold">Matrícula</h2>
          <p className="mt-1 text-sm text-muted">
            Pago único con el primer abono. Sigue válida mientras el alumno
            tenga abono; si pasa más tiempo del indicado sin abono, al volver la
            paga de nuevo. Pon 0 si no cobras matrícula.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Importe (${studio.currency})`}>
            <input
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className={`${inputCls} w-28`}
            />
          </Field>
          <Field label="Caduca tras (días sin abono)">
            <input
              type="number"
              min={1}
              value={feeDays}
              onChange={(e) => setFeeDays(e.target.value)}
              className={`${inputCls} w-28`}
            />
          </Field>
          <button
            type="submit"
            className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white"
          >
            {feeMsg ?? "Guardar"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold">∞ Full pass</h2>
        <FullPassBox sb={sb} studio={studio} />
      </div>

      <fieldset className="rounded-2xl bg-white p-5">
        <legend className="sr-only">Renovación del abono</legend>
        <h2 className="text-base font-bold">Renovación del abono</h2>
        <p className="mt-1 text-sm text-muted">
          Cómo pagan tus alumnos el abono mensual.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {RENEWAL.map(([value, title, help]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                renewal === value
                  ? "border-2 border-accent bg-accent-soft"
                  : "border-line"
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
        <p className="mt-1 text-sm text-muted">
          Activa solo lo que necesitas; lo demás no aparece en tu web.
        </p>
        <div className="mt-3 flex flex-col">
          {MODULES.map(([key, label, help]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 border-t border-line py-3"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-bold">
                  {label}
                  {COMING_SOON.includes(key) && (
                    <span className="rounded-md bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                      Próximamente
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">{help}</div>
              </div>
              {COMING_SOON.includes(key) ? (
                <span className="text-xs text-muted">—</span>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!mods[key]}
                  aria-label={label}
                  onClick={() => toggle(key)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${mods[key] ? "bg-accent" : "bg-full"}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${mods[key] ? "left-6" : "left-1"}`}
                  />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Apariencia ───────────────────────── */

function Appearance({
  sb,
  studio,
  onSaved,
}: {
  sb: SupabaseClient;
  studio: Studio;
  onSaved: (s: Studio) => void;
}) {
  const [accent, setAccent] = useState(studio.accent_color || "#b8235a");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    accent.toLowerCase() !== (studio.accent_color || "").toLowerCase();
  const lowContrast = contrast(accent, "#ffffff") < 3;

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2000);
  }

  async function saveColor() {
    setError(null);
    const { error } = await sb
      .from("studios")
      .update({ accent_color: accent })
      .eq("id", studio.id);
    if (error) setError(error.message);
    else {
      onSaved({ ...studio, accent_color: accent });
      flash("Color guardado ✓");
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Sube el logo en PNG, JPG o WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("El logo no puede pesar más de 2 MB.");
      return;
    }
    setBusy(true);
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${studio.id}/logo-${Date.now()}.${ext}`;
    const up = await sb.storage
      .from("logos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusy(false);
      setError(up.error.message);
      return;
    }
    const url = sb.storage.from("logos").getPublicUrl(path).data.publicUrl;
    const { error } = await sb
      .from("studios")
      .update({ logo_url: url })
      .eq("id", studio.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    removeStored(studio.logo_url);
    onSaved({ ...studio, logo_url: url });
    flash("Logo guardado ✓");
  }

  function removeStored(url: string | null) {
    const marker = "/object/public/logos/";
    if (url && url.includes(marker))
      sb.storage.from("logos").remove([url.split(marker)[1]]);
  }

  async function removeLogo() {
    setError(null);
    const { error } = await sb
      .from("studios")
      .update({ logo_url: null })
      .eq("id", studio.id);
    if (error) {
      setError(error.message);
      return;
    }
    removeStored(studio.logo_url);
    onSaved({ ...studio, logo_url: null });
  }

  return (
    <section className="flex max-w-4xl flex-col gap-5">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">
        Apariencia
      </h1>
      <p className="-mt-2 max-w-2xl text-sm text-muted">
        Elige el color y el logo para que el horario combine con tu web. Los
        cambios se ven al momento en tu horario público.
      </p>
      {error && <ErrorBox text={error} />}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <div className="rounded-2xl bg-white p-5">
            <h2 className="text-base font-bold">Color principal</h2>
            <div
              className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2"
              role="group"
              aria-label="Colores listos"
            >
              {THEME_PRESETS.map((p) => {
                const on = p.accent.toLowerCase() === accent.toLowerCase();
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAccent(p.accent)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs font-semibold ${
                      on ? "border-2 border-ink" : "border-line"
                    }`}
                  >
                    <span
                      className="h-8 w-full rounded-lg"
                      style={{ background: p.accent }}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-white p-1"
                />
                Otro color
              </label>
              <span className="font-mono text-sm text-muted">
                {accent.toUpperCase()}
              </span>
            </div>
            {lowContrast && (
              <p className="mt-3 rounded-xl bg-paper px-3 py-2 text-xs leading-relaxed">
                Es un color claro: en los botones usaremos texto oscuro para que
                se lea bien.
              </p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={saveColor}
                disabled={!dirty}
                className="h-11 rounded-xl bg-ink px-5 text-sm font-bold text-white disabled:opacity-40"
              >
                Guardar color
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => setAccent(studio.accent_color)}
                  className="text-sm underline"
                >
                  Deshacer
                </button>
              )}
              {msg && (
                <span className="text-sm font-semibold text-ok-text">
                  {msg}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5">
            <h2 className="text-base font-bold">Logo</h2>
            <p className="mt-1 text-sm text-muted">
              PNG, JPG o WebP, hasta 2 MB. Mejor con fondo transparente.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex h-16 min-w-16 items-center justify-center rounded-xl bg-ink px-3">
                <StudioLogo
                  name={studio.name}
                  logoUrl={studio.logo_url}
                  size={40}
                />
              </div>
              <label className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-line px-4 text-sm font-bold">
                {busy
                  ? "Subiendo…"
                  : studio.logo_url
                    ? "Cambiar logo"
                    : "Subir logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadLogo}
                  disabled={busy}
                  className="sr-only"
                />
              </label>
              {studio.logo_url && (
                <button
                  type="button"
                  onClick={removeLogo}
                  className="text-sm text-muted underline"
                >
                  Quitar logo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-[1_1_300px]">
          <div className="mb-2 text-xs font-bold text-muted">Vista previa</div>
          <div
            style={themeVars(accent)}
            className="overflow-hidden rounded-2xl border border-line bg-cream"
          >
            <div className="flex items-center gap-2.5 bg-ink px-4 py-3 text-white">
              <StudioLogo
                name={studio.name}
                logoUrl={studio.logo_url}
                size={30}
              />
              <span className="text-sm font-bold">{studio.name}</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="inline-flex w-fit gap-1 rounded-xl bg-white p-1 text-xs font-bold">
                <span className="rounded-lg bg-accent px-3 py-2 text-on-accent">
                  Abono mensual
                </span>
                <span className="px-3 py-2">Clase de prueba</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border-2 border-ink bg-ink p-2.5 text-white">
                  <div className="text-[11px] font-bold opacity-80">
                    ✓ Elegida
                  </div>
                  <div className="text-sm font-bold">Salsa Spicy</div>
                </div>
                <div className="rounded-xl border border-line bg-white p-2.5">
                  <div className="text-sm font-bold">Bachata</div>
                  <div className="text-[11px] font-bold text-ok-text">
                    6 plazas libres
                  </div>
                </div>
              </div>
              <div className="flex justify-between rounded-lg bg-accent-soft px-2 py-1.5 text-xs font-bold text-accent-text">
                <span>2 clases por semana</span>
                <span>60 €</span>
              </div>
              <div className="flex h-11 items-center justify-center rounded-xl bg-accent text-sm font-bold text-on-accent">
                Confirmar abono
              </div>
            </div>
          </div>
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
    <form
      onSubmit={save}
      className="flex flex-col gap-3 rounded-2xl bg-white p-5"
    >
      <div>
        <h2 className="text-base font-bold">Tu contraseña</h2>
        <p className="mt-1 text-sm text-muted">
          Para entrar al panel con email y contraseña, sin esperar el enlace. Tu
          navegador puede guardarla.
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
        <button
          type="submit"
          className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white"
        >
          Guardar contraseña
        </button>
      </div>
      {msg && <p className="text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <ErrorBox text={error} />}
    </form>
  );
}

/* ───────────────────────── Piezas comunes ───────────────────────── */

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-ink";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
  return (
    <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">
      {text}
    </p>
  );
}
