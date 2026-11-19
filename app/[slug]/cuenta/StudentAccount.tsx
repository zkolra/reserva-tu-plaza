"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import LoginForm from "@/app/admin/LoginForm";
import { formatPrice } from "@/lib/pricing";
import { formatDayLong, formatInTz, localDate } from "@/lib/private";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";

export type AccountStudio = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string | null;
  cancel_hours: number;
  renewal_mode: "auto" | "manual" | "choice";
};

type Membership = {
  id: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  auto_renew: boolean;
  payment_method?: string | null;
  enrollment_fee_cents: number;
  plans: { name: string; price_cents: number } | null;
  membership_series: {
    role: string;
    class_series: { name: string; level: string | null; weekday: number; start_time: string; rooms: { name: string } | null } | null;
  }[];
};
type Att = { class_date: string; present: boolean | null; class_series: { name: string; start_time: string } | null };
type Trial = { id: string; class_date: string; status: string; class_series: { name: string; start_time: string } | null };
type PrivateB = { id: string; option_name: string; starts_at: string; status: string; meeting_url: string | null; price_cents: number };

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hhmm = (t: string) => t.slice(0, 5);
const ROLE: Record<string, string> = { leader: "Leader", follower: "Follower" };
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const PAID_AT_SCHOOL: Record<string, string> = { cash: "efectivo", transfer: "transferencia", other: "otro pago" };

export default function StudentAccount({ studio, cfg }: { studio: AccountStudio; cfg: SupabaseConfig }) {
  const { sb, userId, email, ready } = useSession(cfg);
  const tz = studio.timezone || "Europe/Madrid";
  // El email de bienvenida trae ?email=… : así sabemos para quién es el enlace
  const [invited, setInvited] = useState("");
  useEffect(() => {
    setInvited((new URLSearchParams(window.location.search).get("email") ?? "").trim().toLowerCase());
  }, []);

  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [privates, setPrivates] = useState<PrivateB[]>([]);
  const [attendance, setAttendance] = useState<Att[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sb || !userId) return;
    const [m, t, p, prof] = await Promise.all([
      sb
        .from("memberships")
        .select(
          "id, status, starts_on, ends_on, auto_renew, payment_method, enrollment_fee_cents, plans(name, price_cents), membership_series(role, class_series(name, level, weekday, start_time, rooms(name)))",
        )
        .eq("studio_id", studio.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      sb
        .from("trial_bookings")
        .select("id, class_date, status, class_series(name, start_time)")
        .eq("studio_id", studio.id)
        .eq("user_id", userId)
        .maybeSingle(),
      sb
        .from("private_bookings")
        .select("id, option_name, starts_at, status, meeting_url, price_cents")
        .eq("studio_id", studio.id)
        .eq("user_id", userId)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: false })
        .limit(30),
      sb.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle(),
    ]);
    // Solo la asistencia propia (el personal de la escuela podría ver la de todos)
    const myIds = ((m.data ?? []) as { id: string }[]).map((x) => x.id);
    const a = await sb
      .from("class_attendance")
      .select("class_date, present, class_series(name, start_time)")
      .eq("studio_id", studio.id)
      .not("present", "is", null)
      .or(myIds.length ? `user_id.eq.${userId},membership_id.in.(${myIds.join(",")})` : `user_id.eq.${userId}`)
      .order("class_date", { ascending: false })
      .limit(200);
    setAttendance((a.data ?? []) as unknown as Att[]);
    const firstError = [m, t, p].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);
    setMemberships((m.data ?? []) as unknown as Membership[]);
    setTrial((t.data as unknown as Trial) ?? null);
    setPrivates((p.data ?? []) as PrivateB[]);
    setName(prof.data?.full_name ?? "");
    setPhone(prof.data?.phone ?? "");
  }, [sb, userId, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 3000);
  }

  async function call(fn: string, args: Record<string, unknown>, ok: string, confirmText?: string) {
    if (!sb) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    const { error } = await sb.rpc(fn, args);
    if (error) setError(error.message);
    else flash(ok);
    load();
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!sb || !userId) return;
    setError(null);
    const { error } = await sb.from("profiles").upsert({ user_id: userId, full_name: name.trim() || null, phone: phone.trim() || null });
    if (error) setError(error.message);
    else flash("Datos guardados ✓");
  }

  if (!sb) return <p className="p-10">La base de datos no está conectada.</p>;
  if (!ready) return <p className="p-10 text-muted">Cargando…</p>;
  if (!email) return <LoginForm key={invited} sb={sb} title="Mi cuenta" defaultMode="link" defaultEmail={invited} />;

  const today = new Date().toISOString().slice(0, 10);
  const active = (memberships ?? []).find((m) => m.status === "active" && (!m.ends_on || m.ends_on >= today)) ?? null;
  const past = (memberships ?? []).filter((m) => m !== active);
  // Próximos 7 días: las clases del abono (y la clase de prueba)
  const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const week: { date: string; time: string; name: string; extra: string; trial?: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const date = localDate(tz, i);
    const [y, mo, d] = date.split("-").map(Number);
    const isoDow = ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1;
    for (const ms of active?.membership_series ?? []) {
      const c = ms.class_series;
      if (!c || c.weekday !== isoDow) continue;
      if (active?.ends_on && date > active.ends_on) continue;
      if (i === 0 && hhmm(c.start_time) <= nowHm) continue;
      week.push({
        date,
        time: hhmm(c.start_time),
        name: c.name,
        extra: [c.level, c.rooms?.name, ROLE[ms.role]].filter(Boolean).join(" · "),
      });
    }
    if (trial && trial.status !== "cancelled" && trial.class_date === date && trial.class_series)
      week.push({ date, time: hhmm(trial.class_series.start_time), name: trial.class_series.name, extra: "Clase de prueba", trial: true });
  }
  week.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  const todayLocal = localDate(tz, 0);
  const tomorrowLocal = localDate(tz, 1);
  const dayLabel = (d: string) => (d === todayLocal ? "Hoy" : d === tomorrowLocal ? "Mañana" : formatDayLong(d));

  // Asistencia
  const monthPrefix = todayLocal.slice(0, 7);
  const presentMonth = attendance.filter((x) => x.present && x.class_date.startsWith(monthPrefix)).length;
  const presentTotal = attendance.filter((x) => x.present).length;

  const paidAtSchool = !!active && !!PAID_AT_SCHOOL[active.payment_method ?? ""];
  const nowIso = new Date().toISOString();
  const upcoming = privates.filter((p) => p.starts_at >= nowIso).reverse();
  const pastPrivates = privates.filter((p) => p.starts_at < nowIso);
  const when = (ts: string) => formatInTz(ts, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Mi cuenta</h1>
          <p className="mt-1 text-sm text-muted">
            {email} ·{" "}
            <button type="button" className="underline" onClick={() => sb.auth.signOut()}>
              Salir
            </button>
          </p>
        </div>
      </div>

      {invited && invited !== email.toLowerCase() && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink bg-white px-4 py-3 text-sm">
          <span>
            Has entrado como <b>{email}</b>, pero tu abono es para <b>{invited}</b>.
          </span>
          <button type="button" onClick={() => sb.auth.signOut()} className="h-10 rounded-xl bg-ink px-4 font-bold text-white">
            Entrar como {invited}
          </button>
        </div>
      )}

      {msg && <p className="rounded-xl bg-ok-soft px-4 py-3 text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-text">{error}</p>}

      {/* ── Abono ── */}
      <section className="rounded-3xl bg-white p-5">
        <h2 className="font-display text-xl font-bold">Mi abono</h2>
        {memberships === null ? (
          <p className="mt-3 text-muted">Cargando…</p>
        ) : !active ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-muted">No tienes un abono activo.</p>
            <Link href={`/${studio.slug}`} className="flex h-12 w-fit items-center rounded-xl bg-accent px-5 font-bold text-on-accent">
              Elegir mis clases
            </Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-lg font-bold">{active.plans?.name}</div>
              <div className="font-display text-2xl font-bold">
                {active.plans ? formatPrice(active.plans.price_cents, studio.currency) : ""}
                <span className="ml-1 font-sans text-sm font-semibold text-muted">/ mes</span>
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {active.membership_series.map((ms, i) =>
                ms.class_series ? (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2.5 text-sm">
                    <span>
                      <b>{ms.class_series.name}</b>
                      <span className="text-muted">
                        {ms.class_series.level ? ` · ${ms.class_series.level}` : ""}
                        {ms.class_series.rooms?.name ? ` · ${ms.class_series.rooms.name}` : ""}
                        {ROLE[ms.role] ? ` · ${ROLE[ms.role]}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold">
                      {DAYS.at(ms.class_series.weekday - 1)} {hhmm(ms.class_series.start_time)}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>

            <div className={`rounded-xl px-3 py-3 text-sm ${active.auto_renew && !paidAtSchool ? "bg-ok-soft text-ok-text" : "bg-paper"}`}>
              {paidAtSchool ? (
                <>
                  <b>Pagado en la escuela ({PAID_AT_SCHOOL[active.payment_method ?? ""]}) hasta el {active.ends_on ? day(active.ends_on) : "final del mes"}.</b>{" "}
                  Para renovarlo, habla con la escuela.
                </>
              ) : active.auto_renew ? (
                <b>Se renueva automáticamente cada mes.</b>
              ) : (
                <>
                  <b>Válido hasta el {active.ends_on ? day(active.ends_on) : "final del mes"}.</b> No se renueva solo.
                </>
              )}
              <div className="mt-1 text-xs opacity-80">Desde el {day(active.starts_on)}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href={`/${studio.slug}`} className="flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-bold text-white">
                Cambiar mis clases
              </Link>
              {paidAtSchool ? null : active.auto_renew ? (
                <button
                  type="button"
                  onClick={() =>
                    call(
                      "cancel_my_renewal",
                      { p_studio: studio.id },
                      "Listo: tu abono ya no se renovará. Sigues teniendo tus clases hasta el final del mes pagado.",
                      "¿Dejar de renovar tu abono? Seguirás teniendo tus clases hasta el final del mes pagado.",
                    )
                  }
                  className="h-11 rounded-xl border border-line px-4 text-sm font-bold"
                >
                  Dejar de renovar
                </button>
              ) : (
                studio.renewal_mode !== "manual" && (
                  <button
                    type="button"
                    onClick={() => call("resume_my_renewal", { p_studio: studio.id }, "Tu abono se renovará automáticamente cada mes ✓")}
                    className="h-11 rounded-xl border border-line px-4 text-sm font-bold"
                  >
                    Renovar automáticamente
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Esta semana ── */}
      {active && (
        <section className="rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Mis próximas clases</h2>
          {week.length === 0 ? (
            <p className="mt-3 text-muted">No tienes clases en los próximos 7 días.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {week.map((w, k) => (
                <li key={k} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2.5 text-sm">
                  <span className="w-28 shrink-0 font-bold capitalize sm:w-44">{dayLabel(w.date)}</span>
                  <span className="w-12 shrink-0 font-semibold">{w.time}</span>
                  <span className="min-w-0">
                    <b>{w.name}</b>
                    {w.extra && <span className="text-muted"> · {w.extra}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Asistencia ── */}
      {attendance.length > 0 && (
        <section className="rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Mi asistencia</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-paper px-4 py-3">
              <div className="text-xs font-semibold text-muted">Este mes</div>
              <div className="font-display text-2xl font-bold">{presentMonth}</div>
            </div>
            <div className="rounded-xl bg-paper px-4 py-3">
              <div className="text-xs font-semibold text-muted">En total</div>
              <div className="font-display text-2xl font-bold">{presentTotal}</div>
            </div>
          </div>
          <ul className="mt-3 flex flex-col">
            {attendance.slice(0, 8).map((x, k) => (
              <li key={k} className="flex justify-between gap-2 border-t border-line py-2 text-sm">
                <span>
                  <span className="capitalize">{formatDayLong(x.class_date)}</span>
                  <span className="text-muted"> · {x.class_series?.name}</span>
                </span>
                <span className={x.present ? "font-semibold text-ok-text" : "text-muted"}>{x.present ? "Fui ✓" : "No fui"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Clase de prueba ── */}
      {trial && trial.status === "booked" && trial.class_date >= today && (
        <section className="rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Mi clase de prueba</h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <b>{trial.class_series?.name}</b>
              <div className="capitalize text-muted">
                {formatDayLong(trial.class_date)}
                {trial.class_series ? ` · ${hhmm(trial.class_series.start_time)}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                call("cancel_my_trial", { p_studio: studio.id }, "Clase de prueba cancelada. Puedes reservar otro día.", "¿Cancelar tu clase de prueba?")
              }
              className="h-10 rounded-lg border border-line px-3 text-sm font-semibold"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      {/* ── Particulares ── */}
      {(upcoming.length > 0 || pastPrivates.length > 0) && (
        <section className="rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Mis clases particulares</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No tienes clases particulares próximas.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {upcoming.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2.5 text-sm">
                  <span>
                    <b>{p.option_name}</b>
                    <span className="block capitalize text-muted">{when(p.starts_at)}</span>
                    <span className="text-xs text-muted">
                      {p.status === "pending" ? "Pendiente de confirmar" : "Confirmada"}
                      {p.meeting_url && (
                        <>
                          {" · "}
                          <a href={p.meeting_url} target="_blank" className="font-semibold underline">
                            enlace online
                          </a>
                        </>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => call("cancel_my_private", { p_booking: p.id }, "Clase cancelada.", "¿Cancelar esta clase particular?")}
                    className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold"
                  >
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Puedes cancelar hasta {studio.cancel_hours} h antes de la clase.</p>
        </section>
      )}

      {/* ── Datos ── */}
      <form onSubmit={saveProfile} className="flex flex-col gap-3 rounded-3xl bg-white p-5">
        <h2 className="font-display text-xl font-bold">Mis datos</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Nombre
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Teléfono
            <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11 rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-ink" />
          </label>
        </div>
        <button type="submit" className="h-11 w-fit rounded-xl bg-ink px-5 text-sm font-bold text-white">
          Guardar
        </button>
      </form>

      {/* ── Historial ── */}
      {(past.length > 0 || pastPrivates.length > 0) && (
        <section className="rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Historial</h2>
          <ul className="mt-3 flex flex-col">
            {past.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2.5 text-sm">
                <span>
                  <b>{m.plans?.name}</b>
                  <span className="text-muted">
                    {" "}
                    · {day(m.starts_on)}
                    {m.ends_on && m.ends_on !== m.starts_on ? ` – ${day(m.ends_on)}` : ""}
                    {PAID_AT_SCHOOL[m.payment_method ?? ""] ? ` · ${PAID_AT_SCHOOL[m.payment_method ?? ""]}` : ""}
                  </span>
                  {m.status === "cancelled" && (
                    <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-muted">Cancelado</span>
                  )}
                </span>
                <span className="text-muted">
                  {m.plans ? formatPrice(m.plans.price_cents, studio.currency) : ""}
                  {m.enrollment_fee_cents > 0 ? ` + matrícula ${formatPrice(m.enrollment_fee_cents, studio.currency)}` : ""}
                </span>
              </li>
            ))}
            {pastPrivates.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2.5 text-sm">
                <span>
                  <b>{p.option_name}</b>
                  <span className="capitalize text-muted"> · {when(p.starts_at)}</span>
                </span>
                <span className="text-muted">{formatPrice(p.price_cents, studio.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
