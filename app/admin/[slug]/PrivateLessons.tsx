"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/pricing";
import {
  formatDayLong,
  formatInTz,
  localDate,
  localToIso,
  teacherNames,
  type PackPlan,
  type PrivateOption,
  type Slot,
  type Teacher,
} from "@/lib/private";

type StudioLite = { id: string; slug: string; currency: string };
type Settings = { timezone: string; private_requires_confirmation: boolean; private_styles: string[] };
type Booking = {
  id: string;
  option_name: string;
  teacher_ids: string[];
  starts_at: string;
  ends_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  style: string | null;
  role: string;
  status: "pending" | "confirmed" | "cancelled";
  price_cents: number;
  meeting_url: string | null;
  notes: string | null;
  user_id: string | null;
};
type Block = { id: string; teacher_id: string; starts_at: string; ends_at: string; reason: string | null };
type Sub = "reservas" | "horario" | "opciones" | "profesores" | "ajustes";

const ROLE_LABEL: Record<string, string> = { leader: "Leader", follower: "Follower", none: "" };
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DAYS_SHORT = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

export default function PrivateLessons({ sb, studio }: { sb: SupabaseClient; studio: StudioLite }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [options, setOptions] = useState<PrivateOption[]>([]);
  const [packs, setPacks] = useState<PackPlan[]>([]);
  const [sub, setSub] = useState<Sub>("reservas");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s, t, o, p] = await Promise.all([
      sb.from("studio_modules").select("enabled").eq("studio_id", studio.id).eq("module", "private").maybeSingle(),
      sb.from("studios").select("timezone, private_requires_confirmation, private_styles").eq("id", studio.id).single(),
      sb.from("teachers").select("id, name, offers_private, active, sort").eq("studio_id", studio.id).order("sort").order("created_at"),
      sb
        .from("private_options")
        .select("id, name, teacher_ids, duration_min, price_cents, online, active, sort")
        .eq("studio_id", studio.id)
        .order("sort")
        .order("price_cents"),
      sb
        .from("private_pack_plans")
        .select("id, name, option_id, class_count, price_cents, valid_days, active, sort")
        .eq("studio_id", studio.id)
        .order("sort"),
    ]);
    const firstError = [s, t, o, p].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);
    setEnabled(!!m.data?.enabled);
    if (s.data) setSettings({ ...s.data, timezone: s.data.timezone || "Europe/Madrid", private_styles: s.data.private_styles ?? [] });
    setTeachers((t.data ?? []) as Teacher[]);
    setOptions((o.data ?? []) as PrivateOption[]);
    setPacks((p.data ?? []) as PackPlan[]);
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function enable() {
    const { error } = await sb.from("studio_modules").upsert({ studio_id: studio.id, module: "private", enabled: true });
    if (error) setError(error.message);
    load();
  }

  if (enabled === null || !settings) return <p className="text-muted">Cargando…</p>;

  if (!enabled)
    return (
      <section className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Clases particulares</h1>
        <p className="leading-relaxed text-muted">
          Tus alumnos eligen profesor, día y hora libres y reservan solos. Tú decides quién da clases particulares, en qué
          horario y a qué precio.
        </p>
        {error && <ErrorBox text={error} />}
        <button type="button" onClick={enable} className="h-12 w-fit rounded-xl bg-accent px-5 font-bold text-on-accent">
          Activar clases particulares
        </button>
      </section>
    );

  const tz = settings.timezone;
  const subs: [Sub, string][] = [
    ["reservas", "Reservas"],
    ["horario", "Horario disponible"],
    ["opciones", "Opciones y precios"],
    ["profesores", "Profesores"],
    ["ajustes", "Ajustes"],
  ];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Clases particulares</h1>
        <a href={`/${studio.slug}/particulares`} target="_blank" className="text-sm font-semibold underline">
          Ver página pública ↗
        </a>
      </div>
      <div className="flex flex-wrap gap-1 rounded-2xl bg-white p-1" role="tablist" aria-label="Secciones">
        {subs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={sub === key}
            onClick={() => setSub(key)}
            className={`h-10 rounded-xl px-3 text-sm font-bold ${sub === key ? "bg-ink text-white" : "text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorBox text={error} />}

      {teachers.length === 0 && sub !== "profesores" && (
        <p className="rounded-xl bg-paper px-4 py-3 text-sm">
          Empieza por{" "}
          <button type="button" className="font-bold underline" onClick={() => setSub("profesores")}>
            añadir a tus profesores
          </button>
          , luego su horario disponible y las opciones con precio.
        </p>
      )}

      {sub === "reservas" && <Bookings sb={sb} studio={studio} tz={tz} teachers={teachers} options={options} styles={settings.private_styles} />}
      {sub === "horario" && <Availability sb={sb} studio={studio} teachers={teachers.filter((t) => t.offers_private && t.active)} />}
      {sub === "opciones" && <Options sb={sb} studio={studio} teachers={teachers} options={options} packs={packs} onChanged={load} />}
      {sub === "profesores" && <Teachers sb={sb} studio={studio} teachers={teachers} onChanged={load} />}
      {sub === "ajustes" && <PrivateSettings sb={sb} studio={studio} settings={settings} onChanged={load} />}
    </section>
  );
}

/* ───────────────────────── Reservas ───────────────────────── */

function Bookings({
  sb,
  studio,
  tz,
  teachers,
  options,
  styles,
}: {
  sb: SupabaseClient;
  studio: StudioLite;
  tz: string;
  teachers: Teacher[];
  options: PrivateOption[];
  styles: string[];
}) {
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [panel, setPanel] = useState<"none" | "book" | "block">("none");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 864e5).toISOString();
    const [b, k] = await Promise.all([
      sb
        .from("private_bookings")
        .select("id, option_name, teacher_ids, starts_at, ends_at, guest_name, guest_email, guest_phone, style, role, status, price_cents, meeting_url, notes, user_id")
        .eq("studio_id", studio.id)
        .gte("starts_at", since)
        .neq("status", "cancelled")
        .order("starts_at"),
      sb.from("teacher_blocks").select("id, teacher_id, starts_at, ends_at, reason").eq("studio_id", studio.id).gte("ends_at", since).order("starts_at"),
    ]);
    if (b.error) setError(b.error.message);
    setRows((b.data ?? []) as Booking[]);
    setBlocks((k.data ?? []) as Block[]);
  }, [sb, studio.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(b: Booking, status: Booking["status"]) {
    if (status === "cancelled" && !window.confirm(`¿Cancelar la clase de ${b.guest_name ?? "este alumno"}? El horario quedará libre.`)) return;
    const { error } = await sb.from("private_bookings").update({ status }).eq("id", b.id);
    if (error) setError(error.message);
    load();
  }

  async function removeBlock(id: string) {
    const { error } = await sb.from("teacher_blocks").delete().eq("id", id);
    if (error) setError(error.message);
    load();
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of rows ?? []) {
      const key = formatInTz(b.starts_at, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [rows, tz]);

  const time = (ts: string) => formatInTz(ts, tz, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === "book" ? "none" : "book")}
          className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent"
        >
          + Apuntar a un alumno
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === "block" ? "none" : "block")}
          className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold"
        >
          Bloquear horas
        </button>
      </div>
      {error && <ErrorBox text={error} />}

      {panel === "book" && (
        <ManualBooking
          sb={sb}
          tz={tz}
          teachers={teachers}
          options={options.filter((o) => o.active)}
          styles={styles}
          onDone={() => {
            setPanel("none");
            load();
          }}
        />
      )}
      {panel === "block" && (
        <BlockForm
          sb={sb}
          studio={studio}
          tz={tz}
          teachers={teachers.filter((t) => t.active)}
          onDone={() => {
            setPanel("none");
            load();
          }}
        />
      )}

      {rows && rows.length === 0 && (
        <p className="rounded-2xl bg-white p-5 text-muted">No hay clases particulares próximas.</p>
      )}

      {byDay.map(([day, list]) => (
        <div key={day} className="rounded-2xl bg-white p-4">
          <h2 className="mb-2 text-base font-bold capitalize">{formatDayLong(day)}</h2>
          <ul className="flex flex-col">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line py-3 text-sm">
                <span className="w-28 font-bold">
                  {time(b.starts_at)}–{time(b.ends_at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{b.guest_name ?? b.guest_email ?? "Alumno"}</span>
                  <span className="text-muted">
                    {" "}
                    · {b.option_name}
                    {b.style ? ` · ${b.style}` : ""}
                    {ROLE_LABEL[b.role] ? ` · ${ROLE_LABEL[b.role]}` : ""}
                  </span>
                  <span className="block text-xs text-muted">
                    {[b.guest_phone, b.guest_email, b.user_id ? null : "apuntado por la escuela"].filter(Boolean).join(" · ")}
                    {b.notes ? ` · ${b.notes}` : ""}
                  </span>
                  {b.meeting_url && (
                    <a href={b.meeting_url} target="_blank" className="text-xs font-semibold underline">
                      Enlace de la clase online
                    </a>
                  )}
                </span>
                <span className="font-bold">{formatPrice(b.price_cents, studio.currency)}</span>
                {b.status === "pending" ? (
                  <span className="flex gap-2">
                    <span className="rounded-md bg-[#fdefd9] px-2 py-1 text-xs font-bold text-few-text">Pendiente</span>
                    <button type="button" onClick={() => setStatus(b, "confirmed")} className="h-9 rounded-lg bg-ink px-3 text-xs font-bold text-white">
                      Confirmar
                    </button>
                  </span>
                ) : (
                  <span className="rounded-md bg-ok-soft px-2 py-1 text-xs font-bold text-ok-text">Confirmada</span>
                )}
                <button type="button" onClick={() => setStatus(b, "cancelled")} className="text-xs text-muted underline">
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {blocks.length > 0 && (
        <div className="rounded-2xl bg-white p-4">
          <h2 className="mb-2 text-base font-bold">Horas bloqueadas</h2>
          <ul className="flex flex-col">
            {blocks.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5 text-sm">
                <span>
                  <b>{teacherNames([k.teacher_id], teachers)}</b> ·{" "}
                  {formatInTz(k.starts_at, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}–
                  {time(k.ends_at)}
                  {k.reason ? <span className="text-muted"> · {k.reason}</span> : null}
                </span>
                <button type="button" onClick={() => removeBlock(k.id)} className="text-xs text-muted underline">
                  Quitar bloqueo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ManualBooking({
  sb,
  tz,
  teachers,
  options,
  styles,
  onDone,
}: {
  sb: SupabaseClient;
  tz: string;
  teachers: Teacher[];
  options: PrivateOption[];
  styles: string[];
  onDone: () => void;
}) {
  const [optionId, setOptionId] = useState(options[0]?.id ?? "");
  const [date, setDate] = useState(localDate(tz));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [otherTime, setOtherTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [style, setStyle] = useState("");
  const [role, setRole] = useState("none");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!optionId || !date) return;
    let alive = true;
    sb.rpc("private_slots", { p_option: optionId, p_from: date, p_days: 1 }).then(({ data }) => {
      if (alive) setSlots((data ?? []) as Slot[]);
    });
    return () => {
      alive = false;
    };
  }, [sb, optionId, date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const when = otherTime ? localToIso(date, otherTime, tz) : start;
    if (!when) {
      setError("Elige una hora.");
      return;
    }
    setBusy(true);
    const { error } = await sb.rpc("admin_book_private", {
      p_option: optionId,
      p_start: when,
      p_name: name,
      p_phone: phone,
      p_email: email,
      p_style: style,
      p_role: role,
      p_notes: notes,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  if (options.length === 0) return <p className="rounded-xl bg-paper p-4 text-sm">Primero crea una opción en «Opciones y precios».</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border-2 border-ink bg-white p-5">
      <h2 className="text-lg font-bold">Apuntar a un alumno</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <Field label="Clase">
          <select
            value={optionId}
            onChange={(e) => {
              setOptionId(e.target.value);
              setStart(null);
            }}
            className={inputCls}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.duration_min} min
              </option>
            ))}
          </select>
        </Field>
        <Field label="Día">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStart(null);
            }}
            className={inputCls}
          />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold text-muted">Horas libres según el horario disponible</div>
        {slots === null ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">No hay horas libres ese día. Puedes poner otra hora abajo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <button
                key={s.starts_at}
                type="button"
                aria-pressed={start === s.starts_at && !otherTime}
                onClick={() => {
                  setStart(s.starts_at);
                  setOtherTime("");
                }}
                className={`h-10 rounded-lg px-3 text-sm font-bold ${
                  start === s.starts_at && !otherTime ? "bg-ink text-white" : "border border-line bg-white"
                }`}
              >
                {s.local_time}
              </button>
            ))}
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          Otra hora:
          <input type="time" value={otherTime} onChange={(e) => setOtherTime(e.target.value)} className="h-10 rounded-lg border border-line px-2" />
          <span className="text-xs text-muted">(fuera del horario disponible)</span>
        </label>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <Field label="Nombre del alumno">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Teléfono (para recordatorios)">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email (opcional)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        {styles.length > 0 && (
          <Field label="Estilo">
            <select value={style} onChange={(e) => setStyle(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {styles.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Rol">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            <option value="none">—</option>
            <option value="leader">Leader</option>
            <option value="follower">Follower</option>
          </select>
        </Field>
        <Field label="Notas">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Profesores: {teacherNames(options.find((o) => o.id === optionId)?.teacher_ids ?? [], teachers)}
      </p>
      {error && <ErrorBox text={error} />}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent disabled:opacity-40">
          {busy ? "Guardando…" : "Apuntar"}
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function BlockForm({
  sb,
  studio,
  tz,
  teachers,
  onDone,
}: {
  sb: SupabaseClient;
  studio: StudioLite;
  tz: string;
  teachers: Teacher[];
  onDone: () => void;
}) {
  const [who, setWho] = useState<string[]>(teachers[0] ? [teachers[0].id] : []);
  const [date, setDate] = useState(localDate(tz));
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("14:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (who.length === 0) {
      setError("Elige al menos un profesor.");
      return;
    }
    const starts = localToIso(date, allDay ? "00:00" : from, tz);
    const ends = allDay ? localToIso(date, "23:59", tz) : localToIso(date, to, tz);
    if (ends <= starts) {
      setError("La hora final debe ser después de la inicial.");
      return;
    }
    const { error } = await sb
      .from("teacher_blocks")
      .insert(who.map((teacher_id) => ({ studio_id: studio.id, teacher_id, starts_at: starts, ends_at: ends, reason: reason || null })));
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border-2 border-ink bg-white p-5">
      <h2 className="text-lg font-bold">Bloquear horas</h2>
      <div className="flex flex-wrap gap-2">
        {teachers.map((t) => (
          <label key={t.id} className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${who.includes(t.id) ? "border-ink" : "border-line"}`}>
            <input
              type="checkbox"
              checked={who.includes(t.id)}
              onChange={(e) => setWho(e.target.checked ? [...who, t.id] : who.filter((x) => x !== t.id))}
            />
            {t.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Día">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-44`} />
        </Field>
        <label className="flex h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-5 w-5" />
          Todo el día
        </label>
        {!allDay && (
          <>
            <Field label="Desde">
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-32`} />
            </Field>
            <Field label="Hasta">
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-32`} />
            </Field>
          </>
        )}
        <Field label="Motivo (opcional)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} w-56`} />
        </Field>
      </div>
      {error && <ErrorBox text={error} />}
      <div className="flex gap-2">
        <button type="submit" className="h-11 rounded-xl bg-ink px-5 text-sm font-bold text-white">
          Bloquear
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────── Horario disponible ───────────────────────── */

const GRID_START = 8 * 60; // 08:00
const GRID_END = 23 * 60; // 23:00
const STEP = 30;
const ROWS = Array.from({ length: (GRID_END - GRID_START) / STEP }, (_, i) => GRID_START + i * STEP);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function Availability({ sb, studio, teachers }: { sb: SupabaseClient; studio: StudioLite; teachers: Teacher[] }) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [cells, setCells] = useState<Set<string>>(new Set()); // "día-minuto"
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paint = useRef<null | boolean>(null);

  useEffect(() => {
    if (!teacherId) return;
    let alive = true;
    sb.from("teacher_availability")
      .select("weekday, start_time, end_time")
      .eq("teacher_id", teacherId)
      .then(({ data }) => {
        if (!alive) return;
        const set = new Set<string>();
        for (const r of data ?? []) {
          for (let m = toMin(r.start_time); m < toMin(r.end_time); m += STEP) set.add(`${r.weekday}-${m}`);
        }
        setCells(set);
        setSaved(new Set(set));
      });
    return () => {
      alive = false;
    };
  }, [sb, teacherId]);

  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  function apply(key: string, on: boolean) {
    setCells((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function copyToWeekdays(from: number) {
    setCells((prev) => {
      const next = new Set([...prev].filter((k) => Number(k.split("-")[0]) > 5 || Number(k.split("-")[0]) === from));
      for (const k of prev) {
        const [d, m] = k.split("-").map(Number);
        if (d === from) for (let w = 1; w <= 5; w++) next.add(`${w}-${m}`);
      }
      return next;
    });
  }

  async function save() {
    setError(null);
    // Unir medias horas seguidas en franjas
    const rows: { studio_id: string; teacher_id: string; weekday: number; start_time: string; end_time: string }[] = [];
    for (let d = 1; d <= 7; d++) {
      let open: number | null = null;
      for (const m of [...ROWS, GRID_END]) {
        const on = m < GRID_END && cells.has(`${d}-${m}`);
        if (on && open === null) open = m;
        if (!on && open !== null) {
          rows.push({ studio_id: studio.id, teacher_id: teacherId, weekday: d, start_time: hm(open), end_time: hm(m) });
          open = null;
        }
      }
    }
    const del = await sb.from("teacher_availability").delete().eq("teacher_id", teacherId);
    if (del.error) {
      setError(del.error.message);
      return;
    }
    if (rows.length) {
      const ins = await sb.from("teacher_availability").insert(rows);
      if (ins.error) {
        setError(ins.error.message);
        return;
      }
    }
    setSaved(new Set(cells));
    setMsg("Horario guardado ✓");
    setTimeout(() => setMsg(null), 2000);
  }

  const dirty = cells.size !== saved.size || [...cells].some((k) => !saved.has(k));

  if (teachers.length === 0)
    return <p className="rounded-2xl bg-white p-5 text-muted">Añade profesores que den clases particulares en «Profesores».</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {teachers.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={teacherId === t.id}
            onClick={() => {
              if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cambiar de profesor igualmente?")) return;
              setTeacherId(t.id);
            }}
            className={`h-11 rounded-xl px-4 text-sm font-bold ${teacherId === t.id ? "bg-ink text-white" : "border border-line bg-white"}`}
          >
            {t.name}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        Toca o arrastra para marcar cuándo acepta clases particulares. Los alumnos solo podrán reservar dentro de estas horas.
      </p>

      <div className="overflow-x-auto rounded-2xl bg-white p-3">
        <div className="min-w-[620px] select-none" style={{ touchAction: "none" }}>
          <div className="grid gap-1" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
            <div />
            {DAYS_SHORT.map((d, i) => (
              <button key={d} type="button" onClick={() => i < 5 && copyToWeekdays(i + 1)} title={i < 5 ? `Copiar ${DAYS[i]} a lunes–viernes` : undefined} className="pb-1 text-center text-xs font-bold text-muted">
                {d}
              </button>
            ))}
            {ROWS.map((m) => (
              <div key={m} className="contents">
                <div className="pr-1 text-right text-[11px] leading-5 text-muted">{m % 60 === 0 ? hm(m) : ""}</div>
                {DAYS_SHORT.map((_, i) => {
                  const key = `${i + 1}-${m}`;
                  const on = cells.has(key);
                  return (
                    <div
                      key={key}
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${DAYS[i]} ${hm(m)}`}
                      tabIndex={0}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        paint.current = !on;
                        apply(key, !on);
                      }}
                      onPointerEnter={() => paint.current !== null && apply(key, paint.current)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          apply(key, !on);
                        }
                      }}
                      className={`h-5 rounded ${on ? "bg-accent" : "bg-paper hover:bg-line"} ${m % 60 === 0 ? "" : "opacity-90"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted">Consejo: toca el nombre de un día laborable para copiar su horario de lunes a viernes.</p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty} className="h-11 rounded-xl bg-ink px-5 text-sm font-bold text-white disabled:opacity-40">
          Guardar horario
        </button>
        {dirty && (
          <button type="button" onClick={() => setCells(new Set(saved))} className="text-sm underline">
            Deshacer
          </button>
        )}
        {msg && <span className="text-sm font-semibold text-ok-text">{msg}</span>}
      </div>
      {error && <ErrorBox text={error} />}
    </div>
  );
}

/* ───────────────────────── Opciones, precios y bonos ───────────────────────── */

function Options({
  sb,
  studio,
  teachers,
  options,
  packs,
  onChanged,
}: {
  sb: SupabaseClient;
  studio: StudioLite;
  teachers: Teacher[];
  options: PrivateOption[];
  packs: PackPlan[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const privateTeachers = teachers.filter((t) => t.offers_private && t.active);

  async function save(v: Omit<PrivateOption, "id" | "sort">, id?: string) {
    setError(null);
    const row = { ...v, studio_id: studio.id };
    const res = id ? await sb.from("private_options").update(row).eq("id", id) : await sb.from("private_options").insert(row);
    if (res.error) setError(res.error.message);
    else setEditing(null);
    onChanged();
  }

  async function remove(o: PrivateOption) {
    if (!window.confirm(`¿Eliminar «${o.name}»? Las reservas ya hechas se mantienen.`)) return;
    const { error } = await sb.from("private_options").delete().eq("id", o.id);
    if (error) setError(error.message);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Opciones y precios</h2>
            <p className="text-sm text-muted">Con quién se reserva, cuánto dura y cuánto cuesta. Ej.: «Solo Gabriel · 60 min · 60 €».</p>
          </div>
          <button type="button" onClick={() => setEditing("new")} className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent">
            + Añadir opción
          </button>
        </div>
        {error && <ErrorBox text={error} />}
        {editing === "new" && (
          <OptionForm
            teachers={privateTeachers}
            initial={{ name: "", teacher_ids: [], duration_min: 60, price_cents: 0, online: false, active: true }}
            onSave={(v) => save(v)}
            onCancel={() => setEditing(null)}
          />
        )}
        {options.length === 0 && editing !== "new" && <p className="rounded-2xl bg-white p-5 text-muted">Todavía no hay opciones.</p>}
        {options.map((o) =>
          editing === o.id ? (
            <OptionForm key={o.id} teachers={privateTeachers} initial={o} onSave={(v) => save(v, o.id)} onCancel={() => setEditing(null)} />
          ) : (
            <div key={o.id} className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-white p-4 ${o.active ? "" : "opacity-55"}`}>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {o.name}
                  {o.online && <span className="ml-2 rounded-md bg-[#e6ecfb] px-1.5 py-0.5 text-[11px] font-bold text-[#2950c4]">Online</span>}
                  {!o.active && <span className="ml-2 text-xs font-semibold text-muted">(desactivada)</span>}
                </div>
                <div className="text-xs text-muted">
                  {teacherNames(o.teacher_ids, teachers)} · {o.duration_min} min
                </div>
              </div>
              <div className="font-bold">{formatPrice(o.price_cents, studio.currency)}</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(o.id)} className="h-10 rounded-lg border border-line px-3 text-sm font-bold">
                  Editar
                </button>
                <button type="button" onClick={() => remove(o)} aria-label={`Eliminar ${o.name}`} className="h-10 rounded-lg px-3 text-muted hover:text-accent-text">
                  ✕
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      <Packs sb={sb} studio={studio} options={options} packs={packs} onChanged={onChanged} />
    </div>
  );
}

function OptionForm({
  teachers,
  initial,
  onSave,
  onCancel,
}: {
  teachers: Teacher[];
  initial: Omit<PrivateOption, "id" | "sort">;
  onSave: (v: Omit<PrivateOption, "id" | "sort">) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [nameTouched, setNameTouched] = useState(!!initial.name);
  const [price, setPrice] = useState(String(initial.price_cents / 100));
  const autoName = (ids: string[]) => (ids.length === 1 ? "Solo " : "") + teacherNames(ids, teachers);

  function toggleTeacher(id: string, on: boolean) {
    const ids = on ? [...v.teacher_ids, id] : v.teacher_ids.filter((x) => x !== id);
    setV({ ...v, teacher_ids: ids, name: nameTouched ? v.name : ids.length ? autoName(ids) : "" });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.teacher_ids.length === 0) return;
        onSave({ ...v, price_cents: Math.round(Number(price.replace(",", ".") || 0) * 100) });
      }}
      className="flex flex-col gap-4 rounded-2xl border-2 border-ink bg-white p-4"
    >
      <div>
        <div className="mb-2 text-xs font-bold text-muted">Profesores (uno o varios)</div>
        {teachers.length === 0 ? (
          <p className="text-sm text-muted">Añade profesores en la sección «Profesores».</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teachers.map((t) => (
              <label key={t.id} className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${v.teacher_ids.includes(t.id) ? "border-ink" : "border-line"}`}>
                <input type="checkbox" checked={v.teacher_ids.includes(t.id)} onChange={(e) => toggleTeacher(t.id, e.target.checked)} />
                {t.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Field label="Nombre">
          <input
            required
            value={v.name}
            onChange={(e) => {
              setNameTouched(true);
              setV({ ...v, name: e.target.value });
            }}
            className={inputCls}
          />
        </Field>
        <Field label="Duración">
          <select value={v.duration_min} onChange={(e) => setV({ ...v, duration_min: Number(e.target.value) })} className={inputCls}>
            {[30, 45, 60, 75, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </Field>
        <Field label="Precio por clase (€)">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={v.online} onChange={(e) => setV({ ...v, online: e.target.checked })} className="h-5 w-5" />
          Online (se crea un enlace de videollamada)
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} className="h-5 w-5" />
          Visible para los alumnos
        </label>
      </div>
      {v.teacher_ids.length === 0 && <p className="text-xs font-semibold text-accent-text">Elige al menos un profesor.</p>}
      <div className="flex gap-2">
        <button type="submit" className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent">
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Packs({
  sb,
  studio,
  options,
  packs,
  onChanged,
}: {
  sb: SupabaseClient;
  studio: StudioLite;
  options: PrivateOption[];
  packs: PackPlan[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [optionId, setOptionId] = useState("");
  const [count, setCount] = useState("4");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("90");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await sb.from("private_pack_plans").insert({
      studio_id: studio.id,
      name: name || `Bono ${count} clases`,
      option_id: optionId || null,
      class_count: Number(count),
      price_cents: Math.round(Number(price.replace(",", ".") || 0) * 100),
      valid_days: Number(days) || 90,
      sort: packs.length,
    });
    if (error) setError(error.message);
    else {
      setAdding(false);
      setName("");
      setPrice("");
    }
    onChanged();
  }

  async function remove(p: PackPlan) {
    if (!window.confirm(`¿Eliminar «${p.name}»?`)) return;
    const { error } = await sb.from("private_pack_plans").delete().eq("id", p.id);
    if (error) setError(error.message);
    onChanged();
  }

  async function toggle(p: PackPlan) {
    await sb.from("private_pack_plans").update({ active: !p.active }).eq("id", p.id);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Bonos de clases particulares</h2>
          <p className="text-sm text-muted">Ej.: «4 clases con Gabriel por 210 €, válido 90 días». Se podrán comprar al activar los pagos online.</p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold">
            + Añadir bono
          </button>
        )}
      </div>
      {error && <ErrorBox text={error} />}
      {adding && (
        <form onSubmit={add} className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-end gap-3 rounded-2xl border-2 border-ink bg-white p-4">
          <Field label="Para">
            <select value={optionId} onChange={(e) => setOptionId(e.target.value)} className={inputCls}>
              <option value="">Cualquier opción</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nº de clases">
            <input type="number" min={2} value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Precio total (€)">
            <input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Válido (días)">
            <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Nombre (opcional)">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Bono ${count} clases`} className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
              Guardar
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-11 px-2 text-sm underline">
              Cancelar
            </button>
          </div>
        </form>
      )}
      {packs.map((p) => (
        <div key={p.id} className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-white p-4 ${p.active ? "" : "opacity-55"}`}>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{p.name}</div>
            <div className="text-xs text-muted">
              {p.class_count} clases · {options.find((o) => o.id === p.option_id)?.name ?? "cualquier opción"} · válido {p.valid_days} días
            </div>
          </div>
          <div className="font-bold">{formatPrice(p.price_cents, studio.currency)}</div>
          <button type="button" onClick={() => toggle(p)} className="h-10 rounded-lg border border-line px-3 text-sm font-semibold">
            {p.active ? "Desactivar" : "Activar"}
          </button>
          <button type="button" onClick={() => remove(p)} aria-label={`Eliminar ${p.name}`} className="h-10 px-2 text-muted hover:text-accent-text">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Profesores ───────────────────────── */

function Teachers({ sb, studio, teachers, onChanged }: { sb: SupabaseClient; studio: StudioLite; teachers: Teacher[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const { error } = await sb.from("teachers").insert({ studio_id: studio.id, name: name.trim(), sort: teachers.length });
    if (error) setError(error.message);
    setName("");
    onChanged();
  }

  async function update(t: Teacher, patch: Partial<Teacher>) {
    const { error } = await sb.from("teachers").update(patch).eq("id", t.id);
    if (error) setError(error.message);
    onChanged();
  }

  async function remove(t: Teacher) {
    if (!window.confirm(`¿Eliminar a ${t.name}? Se borra su horario disponible. Si prefieres conservarlo, desactívalo.`)) return;
    const { error } = await sb.from("teachers").delete().eq("id", t.id);
    if (error) setError(error.message);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Nuevo profesor">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className={`${inputCls} w-64`} />
        </Field>
        <button type="submit" className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent">
          + Añadir
        </button>
      </form>
      {error && <ErrorBox text={error} />}
      {teachers.map((t) => (
        <div key={t.id} className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white p-4 ${t.active ? "" : "opacity-55"}`}>
          <input
            defaultValue={t.name}
            aria-label="Nombre del profesor"
            onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && update(t, { name: e.target.value.trim() })}
            className="h-10 min-w-0 flex-1 rounded-lg px-2 font-bold outline-none focus:bg-paper"
          />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={t.offers_private} onChange={(e) => update(t, { offers_private: e.target.checked })} className="h-5 w-5" />
            Da clases particulares
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={t.active} onChange={(e) => update(t, { active: e.target.checked })} className="h-5 w-5" />
            Activo
          </label>
          <button type="button" onClick={() => remove(t)} aria-label={`Eliminar ${t.name}`} className="h-10 px-2 text-muted hover:text-accent-text">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Ajustes ───────────────────────── */

function PrivateSettings({
  sb,
  studio,
  settings,
  onChanged,
}: {
  sb: SupabaseClient;
  studio: StudioLite;
  settings: Settings;
  onChanged: () => void;
}) {
  const [styles, setStyles] = useState(settings.private_styles.join(", "));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(p: Partial<Settings>) {
    setError(null);
    const { error } = await sb.from("studios").update(p).eq("id", studio.id);
    if (error) setError(error.message);
    else {
      setMsg("Guardado ✓");
      setTimeout(() => setMsg(null), 1500);
    }
    onChanged();
  }

  async function disable() {
    if (!window.confirm("¿Desactivar las clases particulares? La página pública dejará de mostrarse. Las reservas se conservan.")) return;
    await sb.from("studio_modules").upsert({ studio_id: studio.id, module: "private", enabled: false });
    onChanged();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {error && <ErrorBox text={error} />}
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-white p-5">
        <div>
          <div className="text-sm font-bold">Confirmar cada reserva a mano</div>
          <div className="text-xs text-muted">
            Desactivado: el alumno reserva y queda confirmado. Activado: queda «pendiente» hasta que la confirmes en Reservas.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.private_requires_confirmation}
          aria-label="Confirmar cada reserva a mano"
          onClick={() => patch({ private_requires_confirmation: !settings.private_requires_confirmation })}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${settings.private_requires_confirmation ? "bg-accent" : "bg-full"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${settings.private_requires_confirmation ? "left-6" : "left-1"}`} />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          patch({ private_styles: styles.split(",").map((s) => s.trim()).filter(Boolean) });
        }}
        className="flex flex-col gap-3 rounded-2xl bg-white p-5"
      >
        <div>
          <div className="text-sm font-bold">Estilos que se pueden elegir</div>
          <div className="text-xs text-muted">Separados por comas. Ej.: Salsa, Bachata, Kizomba. Vacío = no se pregunta.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={styles} onChange={(e) => setStyles(e.target.value)} className={`${inputCls} max-w-md`} />
          <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
            Guardar
          </button>
          {msg && <span className="text-sm font-semibold text-ok-text">{msg}</span>}
        </div>
      </form>

      <button type="button" onClick={disable} className="w-fit text-sm text-muted underline">
        Desactivar clases particulares
      </button>
    </div>
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

function ErrorBox({ text }: { text: string }) {
  return <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">{text}</p>;
}
