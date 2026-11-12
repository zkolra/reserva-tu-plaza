"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice, freeSpots, monthlyTiers, otherRoleSpots, tierFor } from "@/lib/pricing";
import type { ClassSeries, DanceRole, StudioData } from "@/lib/types";
import { useAccount, type SupabaseConfig } from "@/lib/useAccount";

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hhmm = (t: string) => t.slice(0, 5);

function spotsText(n: number) {
  if (n <= 0) return "Completo";
  return n === 1 ? "Queda 1 plaza" : `${n} plazas libres`;
}

export default function ClassSelector({ data, supabaseConfig }: { data: StudioData; supabaseConfig: SupabaseConfig }) {
  const { studio, series, plans, availability, modules } = data;
  const rolesOn = modules.roles !== false && series.some((s) => s.uses_roles);
  const [role, setRole] = useState<DanceRole>("follower");
  const [selected, setSelected] = useState<string[]>([]);
  const router = useRouter();
  const account = useAccount(data.isDemo ? null : supabaseConfig, studio.id);
  const mineIds = account.mine?.series ?? [];
  const storeKey = `rtp:${studio.slug}:pending`;

  // Selección pendiente (p. ej. al volver del enlace del email): se recupera una vez
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as { selected: string[]; role: DanceRole };
        setSelected(saved.selected.filter((id) => series.some((s) => s.id === id)));
        setRole(saved.role);
      }
    } catch {}
    setRestored(true);
  }, [storeKey, series]);

  // Si no había nada pendiente, se muestra el abono que ya tiene
  const mine = account.mine;
  useEffect(() => {
    if (!restored || !mine) return;
    let pending = false;
    try {
      pending = !!localStorage.getItem(storeKey);
    } catch {}
    if (!pending) {
      setSelected(mine.series);
      setRole(mine.role);
      setAutoRenew(mine.autoRenew);
    }
  }, [restored, mine, storeKey]);

  function remember(next: string[], nextRole: DanceRole) {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ selected: next, role: nextRole }));
    } catch {}
  }

  // Renovación: el estudio decide; si deja elegir, por defecto automática
  const mode = studio.renewal_mode ?? "choice";
  const [autoRenew, setAutoRenew] = useState(mode !== "manual");
  const effectiveAuto = mode === "auto" ? true : mode === "manual" ? false : autoRenew;
  // Sin sesión no sabemos si ya es alumno: se muestra la matrícula y se descuenta al entrar
  const feeDue = studio.enrollment_fee_cents > 0 && (account.mine ? false : (account.enrollmentDue ?? true));

  const [step, setStep] = useState<"choose" | "email" | "sent" | "done">("choose");
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContinue() {
    setError(null);
    if (!account.enabled) {
      setError("Esto es una demo: conecta la base de datos para guardar reservas.");
      return;
    }
    if (!account.email) {
      remember(selected, role);
      setStep("email");
      return;
    }
    setBusy(true);
    const err = await account.save(selected, role, effectiveAuto);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    try {
      localStorage.removeItem(storeKey);
    } catch {}
    setStep("done");
    router.refresh();
  }

  async function onSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err = await account.sendLink(emailInput.trim());
    setBusy(false);
    if (err) setError(err);
    else setStep("sent");
  }

  const isMine = (id: string) => mineIds.includes(id) && (account.mine?.role === role || !byIdSafe(id)?.uses_roles);
  const byIdSafe = (id: string) => series.find((s) => s.id === id);
  const changed =
    !account.mine ||
    account.mine.role !== role ||
    account.mine.autoRenew !== effectiveAuto ||
    account.mine.series.length !== selected.length ||
    selected.some((id) => !account.mine?.series.includes(id));

  const days = useMemo(() => [...new Set(series.map((s) => s.weekday))].sort((a, b) => a - b), [series]);
  const times = useMemo(() => [...new Set(series.map((s) => hhmm(s.start_time)))].sort(), [series]);
  const tiers = useMemo(() => monthlyTiers(plans), [plans]);
  const trial = plans.find((p) => p.kind === "trial");

  const byId = (id: string) => series.find((s) => s.id === id) as ClassSeries;
  const roleWord = role === "leader" ? "leader" : "follower";

  function toggle(s: ClassSeries) {
    setStep("choose");
    if (selected.includes(s.id)) {
      setSelected(selected.filter((x) => x !== s.id));
      return;
    }
    if (freeSpots(s, availability[s.id], role) <= 0 && !isMine(s.id)) return;
    setSelected([...selected, s.id]);
  }

  const n = selected.length;
  const tier = tierFor(tiers, n);
  const nextTier = tier ? tierFor(tiers, n + 1) : null;
  const hint =
    tier && nextTier && nextTier.plan.id !== tier.plan.id
      ? `Añade otra clase por solo ${formatPrice(nextTier.plan.price_cents - tier.plan.price_cents, studio.currency)} más al mes`
      : tier && tier.plan.classes_per_week === null
        ? "Tienes el abono ilimitado: puedes añadir más clases sin coste extra"
        : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">Elige tus clases</h1>
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">
        Marca las clases a las que quieres venir cada semana. El precio de tu abono se calcula solo.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {rolesOn && (
          <div className="flex items-center gap-2" role="group" aria-label="Rol de baile">
            <span className="text-sm font-bold">Bailo como:</span>
            {(["follower", "leader"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={`h-11 rounded-xl px-4 text-sm font-bold ${
                  role === r ? "bg-ink text-white" : "border border-line bg-white text-ink"
                }`}
              >
                {r === "follower" ? "Follower" : "Leader"}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm text-muted">
          <Legend color="bg-ok" label="Hay plazas" />
          <Legend color="bg-few" label="Quedan pocas" />
          <Legend color="bg-full" label="Completo" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-6">
        <section aria-label="Horario semanal" className="min-w-0 flex-[3_1_640px] rounded-3xl bg-white p-4">
          <div className="overflow-x-auto">
            <div className="flex min-w-[720px] flex-col gap-2">
              <div
                className="grid gap-2 text-sm font-bold text-muted"
                style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}
              >
                <div />
                {days.map((d) => (
                  <div key={d} className="px-1.5 py-1">
                    {DAY_NAMES.at(d - 1)}
                  </div>
                ))}
              </div>

              {times.map((t) => (
                <div
                  key={t}
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}
                >
                  <div className="pt-3 text-sm font-bold">{t}</div>
                  {days.map((d) => {
                    const s = series.find((x) => x.weekday === d && hhmm(x.start_time) === t);
                    if (!s) return <div key={d} className="min-h-[118px] rounded-2xl border border-dashed border-line" />;
                    const a = availability[s.id];
                    const free = freeSpots(s, a, role);
                    const isSel = selected.includes(s.id);
                    const meta = [s.level, s.teachers].filter(Boolean).join(" · ");

                    if (isSel) {
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed="true"
                          onClick={() => toggle(s)}
                          className="flex min-h-[118px] flex-col gap-1 rounded-2xl border-2 border-ink bg-ink p-3 text-left text-white"
                        >
                          <span className="text-xs font-bold text-accent-soft">✓ Elegida</span>
                          <span className="text-sm font-bold">{s.name}</span>
                          <span className="text-xs text-white/75">{meta}</span>
                          <span className="text-xs text-white/75">Toca para quitar</span>
                        </button>
                      );
                    }

                    if (free <= 0 && !isMine(s.id)) {
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled
                          className="flex min-h-[118px] flex-col gap-1 rounded-2xl border border-line bg-paper p-3 text-left text-muted"
                        >
                          <span className="text-sm font-bold">{s.name}</span>
                          <span className="text-xs">{meta}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs font-bold">
                            <Dot color="bg-full" />
                            {s.uses_roles && rolesOn ? `Completo para ${roleWord}` : "Completo"}
                          </span>
                          {modules.waitlist !== false && <span className="text-[11px] underline">Lista de espera</span>}
                        </button>
                      );
                    }

                    const other = otherRoleSpots(s, a, role);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed="false"
                        onClick={() => toggle(s)}
                        className="flex min-h-[118px] flex-col gap-1 rounded-2xl border border-line bg-white p-3 text-left hover:border-ink"
                      >
                        <span className="text-sm font-bold">{s.name}</span>
                        <span className="text-xs text-muted">{meta}</span>
                        <span
                          className={`mt-0.5 flex items-center gap-1.5 text-xs font-bold ${free <= 2 ? "text-few-text" : "text-ok-text"}`}
                        >
                          <Dot color={free <= 2 ? "bg-few" : "bg-ok"} />
                          {isMine(s.id) ? "Tu plaza está reservada" : spotsText(free)}
                          {!isMine(s.id) && s.uses_roles && rolesOn ? ` (${roleWord})` : ""}
                        </span>
                        {s.uses_roles && rolesOn && (
                          <span className="text-[11px] text-muted">
                            {role === "follower" ? "Leaders" : "Followers"}: {other > 0 ? `${other} libres` : "completo"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside aria-label="Tu abono" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-3xl bg-white p-5">
          <h2 className="font-display text-xl font-bold">Tu abono mensual</h2>

          {n === 0 && (
            <p className="text-sm leading-relaxed text-muted">
              Aún no has elegido clases. Toca una clase en el horario para añadirla.
              {trial && (
                <>
                  {" "}
                  ¿Primera vez? Prueba una clase por {formatPrice(trial.price_cents, studio.currency)}.
                </>
              )}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {selected.map((id) => {
              const s = byId(id);
              return (
                <li key={id} className="flex items-center justify-between gap-2 rounded-xl bg-paper py-2 pl-3 pr-1">
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{s.name}</div>
                    <div className="text-xs text-muted">
                      {DAY_NAMES.at(s.weekday - 1)}, {hhmm(s.start_time)}
                      {s.level ? ` · ${s.level}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Quitar ${s.name}`}
                    onClick={() => toggle(s)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>

          {tiers.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              {tiers.map((t) => (
                <div
                  key={t.plan.id}
                  className={`flex justify-between rounded-lg px-2 py-1.5 text-sm ${
                    tier?.plan.id === t.plan.id ? "bg-accent-soft font-bold text-accent" : "text-muted"
                  }`}
                >
                  <span>{t.label}</span>
                  <span>{formatPrice(t.plan.price_cents, studio.currency)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">
              {n === 0 ? "0 clases" : n === 1 ? "1 clase por semana" : `${n} clases por semana`}
            </span>
            <span className="font-display text-3xl font-bold">
              {formatPrice(tier?.plan.price_cents ?? 0, studio.currency)}
            </span>
          </div>
          <div className="-mt-3 text-right text-xs text-muted">al mes</div>

          {n > 0 && studio.enrollment_fee_cents > 0 && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className={feeDue ? "font-semibold" : "text-muted"}>Matrícula (pago único)</span>
                <span className={feeDue ? "font-bold" : "text-muted line-through"}>
                  {formatPrice(studio.enrollment_fee_cents, studio.currency)}
                </span>
              </div>
              {feeDue ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold">Hoy pagas</span>
                    <span className="text-xl font-bold">
                      {formatPrice((tier?.plan.price_cents ?? 0) + studio.enrollment_fee_cents, studio.currency)}
                    </span>
                  </div>
                  {!account.email && account.enabled && (
                    <p className="text-xs leading-relaxed text-muted">
                      ¿Ya eres alumno/a? Entra con tu email al continuar y, si tu matrícula sigue vigente, se descuenta.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs font-semibold text-ok-text">Ya eres alumno/a: no pagas matrícula.</p>
              )}
            </div>
          )}

          {hint && <div className="rounded-xl bg-ok-soft px-3 py-2.5 text-sm font-semibold text-ok-text">{hint}</div>}

          {n > 0 && mode === "choice" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold">¿Cómo quieres pagar?</legend>
              {[
                [true, "Cada mes automáticamente", "Se renueva solo con las mismas clases. Cancela o cambia cuando quieras."],
                [false, "Solo este mes", "Válido un mes. El mes que viene eliges tus clases de nuevo."],
              ].map(([value, title, help]) => (
                <label
                  key={String(value)}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                    autoRenew === value ? "border-2 border-accent bg-accent-soft" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="renewal"
                    checked={autoRenew === value}
                    onChange={() => setAutoRenew(value as boolean)}
                    className="mt-1 h-4 w-4 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-bold">{title as string}</span>
                    <span className="block text-xs text-muted">{help as string}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {n > 0 && mode === "auto" && (
            <p className="text-xs leading-relaxed text-muted">Se renueva automáticamente cada mes. Cancela o cambia cuando quieras.</p>
          )}
          {n > 0 && mode === "manual" && (
            <p className="text-xs leading-relaxed text-muted">Válido un mes. El mes que viene eliges tus clases de nuevo.</p>
          )}

          {account.mine && !changed && step !== "done" && (
            <p className="rounded-xl bg-paper px-3 py-2.5 text-sm">
              {account.mine.autoRenew
                ? "Tu abono se renueva automáticamente cada mes."
                : `Tu abono es válido hasta el ${account.mine.endsOn ? new Date(account.mine.endsOn).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "final del mes"}.`}
            </p>
          )}

          {step === "done" && !changed ? (
            <div className="rounded-xl bg-ok-soft px-3 py-3 text-sm font-semibold text-ok-text">
              ¡Listo! Tu abono está guardado. Puedes volver aquí cuando quieras para cambiar de clases.
            </div>
          ) : step === "email" ? (
            <form onSubmit={onSendLink} className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-bold">
                Tu email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="nombre@email.com"
                className="h-12 rounded-xl border border-line px-3 text-base outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-13 rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-40"
              >
                {busy ? "Enviando…" : "Enviarme el enlace"}
              </button>
              <p className="text-xs leading-relaxed text-muted">
                Te enviamos un enlace para entrar, sin contraseña. Tu selección se guarda mientras tanto.
              </p>
            </form>
          ) : step === "sent" ? (
            <div className="rounded-xl bg-paper px-3 py-3 text-sm leading-relaxed">
              Te hemos enviado un enlace a <b>{emailInput}</b>. Ábrelo en este mismo dispositivo para confirmar tu abono.
            </div>
          ) : (
            <button
              type="button"
              onClick={onContinue}
              disabled={n === 0 || busy || !changed}
              className="h-13 rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-40"
            >
              {busy
                ? "Guardando…"
                : !account.email
                  ? "Continuar"
                  : account.mine
                    ? changed
                      ? "Guardar cambios"
                      : "Este es tu abono actual"
                    : "Confirmar abono"}
            </button>
          )}

          {error && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">{error}</p>}

          {account.email && (
            <p className="text-xs text-muted">
              Has entrado como {account.email} ·{" "}
              <button type="button" onClick={account.signOut} className="underline">
                Salir
              </button>
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted">
            El pago online llegará pronto; de momento el estudio te indicará cómo pagar.{" "}
            Puedes cambiar de clases o pausar tu abono desde tu cuenta, sin escribir a nadie. Cancelación gratis hasta{" "}
            {studio.cancel_hours} h antes de cada clase.
          </p>
          {data.isDemo && (
            <p className="text-xs text-muted">
              Datos de ejemplo{data.demoReason ? ` — ${data.demoReason}` : ""}.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
