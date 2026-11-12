"use client";

import { useMemo, useState } from "react";
import { formatPrice, freeSpots, monthlyTiers, otherRoleSpots, tierFor } from "@/lib/pricing";
import type { ClassSeries, DanceRole, StudioData } from "@/lib/types";

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const hhmm = (t: string) => t.slice(0, 5);

function spotsText(n: number) {
  if (n <= 0) return "Completo";
  return n === 1 ? "Queda 1 plaza" : `${n} plazas libres`;
}

export default function ClassSelector({ data }: { data: StudioData }) {
  const { studio, series, plans, availability, modules } = data;
  const rolesOn = modules.roles !== false && series.some((s) => s.uses_roles);
  const [role, setRole] = useState<DanceRole>("follower");
  const [selected, setSelected] = useState<string[]>([]);

  const days = useMemo(() => [...new Set(series.map((s) => s.weekday))].sort((a, b) => a - b), [series]);
  const times = useMemo(() => [...new Set(series.map((s) => hhmm(s.start_time)))].sort(), [series]);
  const tiers = useMemo(() => monthlyTiers(plans), [plans]);
  const trial = plans.find((p) => p.kind === "trial");

  const byId = (id: string) => series.find((s) => s.id === id) as ClassSeries;
  const roleWord = role === "leader" ? "leader" : "follower";

  function toggle(s: ClassSeries) {
    if (selected.includes(s.id)) {
      setSelected(selected.filter((x) => x !== s.id));
      return;
    }
    if (freeSpots(s, availability[s.id], role) <= 0) return;
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

                    if (free <= 0) {
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
                          {spotsText(free)}
                          {s.uses_roles && rolesOn ? ` (${roleWord})` : ""}
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

          {hint && <div className="rounded-xl bg-ok-soft px-3 py-2.5 text-sm font-semibold text-ok-text">{hint}</div>}

          <button
            type="button"
            disabled={n === 0}
            className="h-13 rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-40"
          >
            Continuar al pago
          </button>
          <p className="text-xs leading-relaxed text-muted">
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
