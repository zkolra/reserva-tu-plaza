"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/pricing";
import { formatDayLong, formatInTz, localDate, teacherNames, type PrivateData, type Slot } from "@/lib/private";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";

type Pending = { optionId: string; style: string; role: string; start: string; name: string; phone: string };
type MyBooking = {
  id: string;
  option_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  meeting_url: string | null;
};

const DAYS_AHEAD = 21;

export default function PrivateBooking({ data, cfg }: { data: PrivateData; cfg: SupabaseConfig }) {
  const { studio, teachers, packs } = data;
  const tz = studio.timezone || "Europe/Madrid";
  const { sb, email, userId } = useSession(cfg);
  const storeKey = `rtp:${studio.slug}:private`;

  // Solo opciones cuyos profesores siguen dando clases particulares
  const options = useMemo(
    () =>
      data.options.filter(
        (o) => o.active && o.teacher_ids.every((id) => teachers.some((t) => t.id === id && t.active && t.offers_private)),
      ),
    [data.options, teachers],
  );

  const [optionId, setOptionId] = useState<string | null>(options.length === 1 ? options[0].id : null);
  const [style, setStyle] = useState("");
  const [role, setRole] = useState("none");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"choose" | "email" | "sent" | "done">("choose");
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MyBooking | null>(null);
  const [mine, setMine] = useState<MyBooking[]>([]);

  const option = options.find((o) => o.id === optionId) ?? null;

  // Recuperar la elección después de volver del enlace del email
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return;
      const p = JSON.parse(raw) as Pending;
      if (!options.some((o) => o.id === p.optionId)) return;
      setOptionId(p.optionId);
      setStyle(p.style);
      setRole(p.role);
      setName(p.name);
      setPhone(p.phone);
      setStart(p.start);
      setDay(formatInTz(p.start, tz, { year: "numeric", month: "2-digit", day: "2-digit" }));
    } catch {}
  }, [storeKey, options, tz]);

  const loadSlots = useCallback(async () => {
    if (!sb || !optionId) return;
    setSlots(null);
    const { data: rows } = await sb.rpc("private_slots", { p_option: optionId, p_from: localDate(tz), p_days: DAYS_AHEAD });
    setSlots((rows ?? []) as Slot[]);
  }, [sb, optionId, tz]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const loadMine = useCallback(async () => {
    if (!sb || !userId) return;
    const { data: rows } = await sb
      .from("private_bookings")
      .select("id, option_name, starts_at, ends_at, status, meeting_url")
      .eq("studio_id", studio.id)
      .neq("status", "cancelled")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at");
    setMine((rows ?? []) as MyBooking[]);
  }, [sb, userId, studio.id]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots ?? []) map.set(s.local_date, [...(map.get(s.local_date) ?? []), s]);
    return map;
  }, [slots]);
  const dayList = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => localDate(tz, i)), [tz]);
  const chosenSlot = (slots ?? []).find((s) => s.starts_at === start) ?? null;

  function pickOption(id: string) {
    setOptionId(id);
    setDay(null);
    setStart(null);
    setStep("choose");
    setError(null);
  }

  async function onContinue() {
    setError(null);
    if (!sb || !option || !start) return;
    if (!email) {
      try {
        localStorage.setItem(storeKey, JSON.stringify({ optionId: option.id, style, role, start, name, phone } satisfies Pending));
      } catch {}
      setStep("email");
      return;
    }
    setBusy(true);
    const { data: id, error } = await sb.rpc("book_private", {
      p_option: option.id,
      p_start: start,
      p_style: style,
      p_role: role,
      p_name: name,
      p_phone: phone,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      loadSlots();
      return;
    }
    try {
      localStorage.removeItem(storeKey);
    } catch {}
    const { data: b } = await sb.from("private_bookings").select("id, option_name, starts_at, ends_at, status, meeting_url").eq("id", id).single();
    setDone((b as MyBooking) ?? null);
    setStep("done");
    loadSlots();
    loadMine();
  }

  async function onSendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email: emailInput.trim(),
      options: { emailRedirectTo: window.location.href.split("#")[0] },
    });
    setBusy(false);
    if (error) setError(error.message.includes("rate limit") ? "Demasiados emails en poco tiempo. Prueba en un rato." : error.message);
    else setStep("sent");
  }

  const when = (ts: string) => formatInTz(ts, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  if (options.length === 0)
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl font-bold">Clases particulares</h1>
        <p className="mt-4 text-muted">Pronto podrás reservar clases particulares aquí.</p>
      </main>
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">Clases particulares</h1>
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">
        Elige con quién, el día y la hora. Solo ves las horas que están libres.
      </p>

      <div className="mt-6 flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[3_1_600px] flex-col gap-6">
          <section aria-labelledby="h-quien" className="flex flex-col gap-3">
            <h2 id="h-quien" className="text-lg font-bold">
              1. ¿Con quién?
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {options.map((o) => {
                const on = o.id === optionId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickOption(o.id)}
                    className={`flex flex-col gap-1 rounded-2xl p-4 text-left ${on ? "border-2 border-ink bg-ink text-white" : "border border-line bg-white hover:border-ink"}`}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      {o.name}
                      {o.online && (
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${on ? "bg-white/20" : "bg-[#e6ecfb] text-[#2950c4]"}`}>
                          Online
                        </span>
                      )}
                    </span>
                    <span className={`text-xs ${on ? "text-white/75" : "text-muted"}`}>
                      {teacherNames(o.teacher_ids, teachers)} · {o.duration_min} min
                    </span>
                    <span className="mt-1 font-display text-xl font-bold">{formatPrice(o.price_cents, studio.currency)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {option && (studio.private_styles.length > 0 || data.rolesEnabled) && (
            <section aria-labelledby="h-que" className="flex flex-col gap-3">
              <h2 id="h-que" className="text-lg font-bold">
                2. ¿Qué quieres trabajar?
              </h2>
              {studio.private_styles.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Estilo">
                  {studio.private_styles.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={style === s}
                      onClick={() => setStyle(style === s ? "" : s)}
                      className={`h-11 rounded-xl px-4 text-sm font-bold ${style === s ? "bg-ink text-white" : "border border-line bg-white"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {data.rolesEnabled && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rol">
                  <span className="text-sm font-bold">Como:</span>
                  {[
                    ["leader", "Leader"],
                    ["follower", "Follower"],
                    ["none", "Da igual"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={role === value}
                      onClick={() => setRole(value)}
                      className={`h-11 rounded-xl px-4 text-sm font-bold ${role === value ? "bg-ink text-white" : "border border-line bg-white"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {option && (
            <section aria-labelledby="h-cuando" className="flex flex-col gap-3">
              <h2 id="h-cuando" className="text-lg font-bold">
                {studio.private_styles.length > 0 || data.rolesEnabled ? "3" : "2"}. ¿Cuándo?
              </h2>
              {slots === null ? (
                <p className="text-sm text-muted">Buscando horas libres…</p>
              ) : slots.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-muted">
                  No hay horas libres en las próximas semanas. Escribe a la escuela para buscar otro momento.
                </p>
              ) : (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Día">
                    {dayList.map((d) => {
                      const has = byDay.has(d);
                      const [, m, dd] = d.split("-").map(Number);
                      const wd = new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", timeZone: "UTC" });
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!has}
                          aria-pressed={day === d}
                          onClick={() => {
                            setDay(d);
                            setStart(null);
                          }}
                          className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-xs font-semibold ${
                            day === d ? "bg-ink text-white" : has ? "bg-white" : "bg-transparent text-muted opacity-40"
                          }`}
                        >
                          <span className="capitalize">{wd}</span>
                          <span className="text-base font-bold">{dd}</span>
                          <span className="sr-only">/{m}</span>
                        </button>
                      );
                    })}
                  </div>
                  {day && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Hora">
                      {(byDay.get(day) ?? []).map((s) => (
                        <button
                          key={s.starts_at}
                          type="button"
                          aria-pressed={start === s.starts_at}
                          onClick={() => {
                            setStart(s.starts_at);
                            setStep("choose");
                          }}
                          className={`h-11 rounded-xl px-4 text-sm font-bold ${start === s.starts_at ? "bg-accent text-on-accent" : "border border-line bg-white"}`}
                        >
                          {s.local_time}
                        </button>
                      ))}
                    </div>
                  )}
                  {!day && <p className="text-sm text-muted">Elige un día.</p>}
                </>
              )}
            </section>
          )}

          {packs.filter((p) => p.active).length > 0 && (
            <section aria-labelledby="h-bonos" className="flex flex-col gap-3">
              <h2 id="h-bonos" className="text-lg font-bold">
                Bonos
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {packs
                  .filter((p) => p.active)
                  .map((p) => (
                    <div key={p.id} className="rounded-2xl bg-white p-4">
                      <div className="font-bold">{p.name}</div>
                      <div className="text-xs text-muted">
                        {p.class_count} clases · {data.options.find((o) => o.id === p.option_id)?.name ?? "cualquier opción"} · válido{" "}
                        {p.valid_days} días
                      </div>
                      <div className="mt-1 font-display text-xl font-bold">{formatPrice(p.price_cents, studio.currency)}</div>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted">Pídelos en la escuela; pronto podrás comprarlos aquí.</p>
            </section>
          )}
        </div>

        <aside aria-label="Tu reserva" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Tu reserva</h2>

          {step === "done" && done ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl bg-ok-soft px-3 py-3 text-sm font-semibold text-ok-text">
                {done.status === "pending"
                  ? "¡Solicitud enviada! La escuela la confirmará pronto."
                  : "¡Reservada! Te esperamos."}
              </div>
              <div className="text-sm">
                <b>{done.option_name}</b>
                <div className="capitalize text-muted">{when(done.starts_at)}</div>
              </div>
              {done.meeting_url && (
                <a href={done.meeting_url} target="_blank" className="text-sm font-bold underline">
                  Enlace de la clase online
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setStep("choose");
                  setStart(null);
                  setDone(null);
                }}
                className="h-11 rounded-xl border border-line text-sm font-bold"
              >
                Reservar otra clase
              </button>
            </div>
          ) : (
            <>
              {!option ? (
                <p className="text-sm text-muted">Elige con quién quieres la clase.</p>
              ) : (
                <div className="flex flex-col gap-1 rounded-xl bg-paper px-3 py-2.5 text-sm">
                  <b>{option.name}</b>
                  <span className="text-muted">
                    {option.duration_min} min{style ? ` · ${style}` : ""}
                    {role !== "none" ? ` · ${role === "leader" ? "Leader" : "Follower"}` : ""}
                  </span>
                  <span className="capitalize">{chosenSlot ? when(chosenSlot.starts_at) : day ? formatDayLong(day) : "Elige día y hora"}</span>
                </div>
              )}

              {option && (
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="text-sm font-semibold">Precio</span>
                  <span className="font-display text-3xl font-bold">{formatPrice(option.price_cents, studio.currency)}</span>
                </div>
              )}

              {option && start && step === "choose" && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="pv-name" className="text-sm font-bold">
                    Tu nombre
                  </label>
                  <input
                    id="pv-name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 rounded-xl border border-line px-3 text-base outline-none focus:border-ink"
                  />
                  <label htmlFor="pv-phone" className="text-sm font-bold">
                    Teléfono <span className="font-normal text-muted">(para avisos de la escuela)</span>
                  </label>
                  <input
                    id="pv-phone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-12 rounded-xl border border-line px-3 text-base outline-none focus:border-ink"
                  />
                </div>
              )}

              {step === "email" ? (
                <form onSubmit={onSendLink} className="flex flex-col gap-2">
                  <label htmlFor="pv-email" className="text-sm font-bold">
                    Tu email
                  </label>
                  <input
                    id="pv-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="h-12 rounded-xl border border-line px-3 text-base outline-none focus:border-ink"
                  />
                  <button type="submit" disabled={busy} className="h-13 rounded-2xl bg-accent font-bold text-on-accent disabled:opacity-40">
                    {busy ? "Enviando…" : "Enviarme el enlace"}
                  </button>
                  <p className="text-xs text-muted">Te enviamos un enlace para entrar, sin contraseña. Tu elección se guarda.</p>
                </form>
              ) : step === "sent" ? (
                <div className="rounded-xl bg-paper px-3 py-3 text-sm leading-relaxed">
                  Te hemos enviado un enlace a <b>{emailInput}</b>. Ábrelo en este dispositivo para confirmar la reserva.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={!option || !start || busy}
                  className="h-13 rounded-2xl bg-accent text-base font-bold text-on-accent disabled:opacity-40"
                >
                  {busy ? "Reservando…" : email ? (studio.private_requires_confirmation ? "Enviar solicitud" : "Reservar") : "Continuar"}
                </button>
              )}

              {error && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">{error}</p>}
              <p className="text-xs leading-relaxed text-muted">
                {studio.private_requires_confirmation ? "La escuela confirma cada reserva. " : ""}
                El pago online llegará pronto; de momento pagas en la escuela.
              </p>
            </>
          )}

          {email && (
            <p className="text-xs text-muted">
              Has entrado como {email} ·{" "}
              <button type="button" onClick={() => sb?.auth.signOut()} className="underline">
                Salir
              </button>
            </p>
          )}

          {mine.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <h3 className="text-sm font-bold">Tus próximas clases particulares</h3>
              {mine.map((b) => (
                <div key={b.id} className="rounded-xl bg-paper px-3 py-2 text-xs">
                  <b className="text-sm">{b.option_name}</b>
                  <div className="capitalize">{when(b.starts_at)}</div>
                  <div className="text-muted">
                    {b.status === "pending" ? "Pendiente de confirmar" : "Confirmada"}
                    {b.meeting_url && (
                      <>
                        {" · "}
                        <a href={b.meeting_url} target="_blank" className="font-semibold underline">
                          enlace online
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
