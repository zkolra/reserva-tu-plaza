"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDayLong, localDate } from "@/lib/private";

type Series = {
  id: string;
  name: string;
  level: string | null;
  teachers: string | null;
  start_time: string;
  duration_min: number;
  uses_roles: boolean;
  capacity: number | null;
  capacity_leaders: number | null;
  capacity_followers: number | null;
  rooms: { name: string } | null;
};
type RosterRow = {
  series_id: string;
  user_id: string | null;
  membership_id: string | null;
  attendance_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: "leader" | "follower" | "none";
  kind: "abono" | "prueba" | "visitante";
  present: boolean | null;
};

const hhmm = (t: string) => t.slice(0, 5);
const ROLE: Record<string, string> = { leader: "Leader", follower: "Follower", none: "" };

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function isoWeekday(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

export default function Attendance({ sb, studio }: { sb: SupabaseClient; studio: { id: string; timezone?: string | null } }) {
  const tz = studio.timezone || "Europe/Madrid";
  const today = localDate(tz);
  const [date, setDate] = useState(today);
  const [series, setSeries] = useState<Series[] | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [s, r] = await Promise.all([
      sb
        .from("class_series")
        .select("id, name, level, teachers, start_time, duration_min, uses_roles, capacity, capacity_leaders, capacity_followers, rooms(name)")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .eq("weekday", isoWeekday(date))
        .order("start_time"),
      sb.rpc("class_roster_day", { p_studio: studio.id, p_date: date }),
    ]);
    if (s.error || r.error) setError((s.error ?? r.error)!.message);
    setSeries((s.data ?? []) as unknown as Series[]);
    setRoster((r.data ?? []) as RosterRow[]);
  }, [sb, studio.id, date]);

  useEffect(() => {
    load();
  }, [load]);

  const bySeries = useMemo(() => {
    const map = new Map<string, RosterRow[]>();
    for (const row of roster) map.set(row.series_id, [...(map.get(row.series_id) ?? []), row]);
    return map;
  }, [roster]);

  // Cambio optimista: se ve al momento y luego se guarda
  async function mark(row: RosterRow, present: boolean | null) {
    setRoster((prev) => prev.map((r) => (r === row ? { ...r, present } : r)));
    if (row.kind === "visitante") {
      if (present === null || present === false) {
        if (!window.confirm(`¿Quitar a ${row.name} de la lista?`)) {
          load();
          return;
        }
        await sb.from("class_attendance").delete().eq("id", row.attendance_id);
      }
    } else {
      const { error } = await sb.rpc("set_attendance_v2", {
        p_series: row.series_id,
        p_date: date,
        p_user: row.user_id,
        p_membership: row.user_id ? null : row.membership_id,
        p_present: present,
      });
      if (error) setError(error.message);
    }
    load();
  }

  async function markAll(seriesId: string) {
    const rows = (bySeries.get(seriesId) ?? []).filter((r) => r.kind !== "visitante" && r.present !== true);
    setRoster((prev) => prev.map((r) => (rows.includes(r) ? { ...r, present: true } : r)));
    await Promise.all(
      rows.map((r) =>
        sb.rpc("set_attendance_v2", {
          p_series: seriesId,
          p_date: date,
          p_user: r.user_id,
          p_membership: r.user_id ? null : r.membership_id,
          p_present: true,
        }),
      ),
    );
    load();
  }

  async function addGuest(seriesId: string, name: string, role: string) {
    const { error } = await sb.rpc("add_attendance_guest", { p_series: seriesId, p_date: date, p_name: name, p_role: role });
    if (error) setError(error.message);
    load();
  }

  const isFuture = date > today;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Asistencia</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-lg">
            ‹
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Día"
            className="h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold"
          />
          <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-lg">
            ›
          </button>
          {date !== today && (
            <button type="button" onClick={() => setDate(today)} className="ml-1 h-11 rounded-xl px-3 text-sm font-bold underline">
              Hoy
            </button>
          )}
        </div>
      </div>
      <p className="-mt-3 text-sm font-semibold capitalize text-muted">
        {date === today ? "Hoy, " : ""}
        {formatDayLong(date)}
      </p>
      {error && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">{error}</p>}

      {series === null ? (
        <p className="text-muted">Cargando…</p>
      ) : series.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-muted">No hay clases este día.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {series.map((s) => {
            const rows = bySeries.get(s.id) ?? [];
            const enrolled = rows;
            const leaders = rows.filter((r) => r.role === "leader").length;
            const followers = rows.filter((r) => r.role === "follower").length;
            const extra = rows.filter((r) => r.kind === "visitante").length;
            const present = rows.filter((r) => r.present === true).length;
            const cap = s.uses_roles ? (s.capacity_leaders ?? 0) + (s.capacity_followers ?? 0) : (s.capacity ?? 0);
            const isOpen = open === s.id;
            return (
              <div key={s.id} className="overflow-hidden rounded-2xl bg-white">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 p-4 text-left hover:bg-paper"
                >
                  <span className="w-14 text-lg font-bold">{hhmm(s.start_time)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{s.name}</span>
                    <span className="block text-xs text-muted">{[s.level, s.teachers, s.rooms?.name].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-sm">
                    <b>{enrolled.length}</b>
                    <span className="text-muted">/{cap} apuntados</span>
                    {extra > 0 && <span className="text-muted"> · {extra} sin abono</span>}
                    {s.uses_roles && (
                      <span className="block text-xs text-muted">
                        {leaders} leaders · {followers} followers
                      </span>
                    )}
                  </span>
                  {!isFuture && (
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${present > 0 ? "bg-ok-soft text-ok-text" : "bg-paper text-muted"}`}>
                      {present} {present === 1 ? "presente" : "presentes"}
                    </span>
                  )}
                  <span aria-hidden="true" className="text-muted">
                    {isOpen ? "▴" : "▾"}
                  </span>
                </button>

                {isOpen && (
                  <Roster
                    rows={rows}
                    canMark={!isFuture}
                    usesRoles={s.uses_roles}
                    onMark={mark}
                    onMarkAll={() => markAll(s.id)}
                    onAddGuest={(name, role) => addGuest(s.id, name, role)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Roster({
  rows,
  canMark,
  usesRoles,
  onMark,
  onMarkAll,
  onAddGuest,
}: {
  rows: RosterRow[];
  canMark: boolean;
  usesRoles: boolean;
  onMark: (r: RosterRow, present: boolean | null) => void;
  onMarkAll: () => void;
  onAddGuest: (name: string, role: string) => void;
}) {
  const [guest, setGuest] = useState("");
  const [guestRole, setGuestRole] = useState("none");

  return (
    <div className="border-t border-line p-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nadie apuntado todavía.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={`${r.user_id ?? r.membership_id ?? r.attendance_id}`} className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{r.name}</span>
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {r.kind === "prueba" && <Badge tone="blue">Clase de prueba</Badge>}
                  {r.kind === "visitante" && <Badge tone="orange">Sin abono</Badge>}
                  {ROLE[r.role] && <Badge tone="gray">{ROLE[r.role]}</Badge>}
                </span>
                {(r.phone || r.email) && <span className="block text-xs text-muted">{[r.phone, r.email].filter(Boolean).join(" · ")}</span>}
              </span>
              {!canMark && r.kind === "visitante" && (
                <button type="button" onClick={() => onMark(r, null)} aria-label={`Quitar a ${r.name}`} className="h-11 rounded-xl px-3 text-muted hover:text-accent-text">
                  ✕
                </button>
              )}
              {canMark && (
                <span className="flex gap-1" role="group" aria-label={`Asistencia de ${r.name}`}>
                  <button
                    type="button"
                    aria-pressed={r.present === true}
                    onClick={() => onMark(r, r.present === true ? null : true)}
                    className={`h-11 rounded-xl px-4 text-sm font-bold ${r.present === true ? "bg-ok text-white" : "border border-line bg-white"}`}
                  >
                    ✓ Vino
                  </button>
                  {r.kind !== "visitante" && (
                    <button
                      type="button"
                      aria-pressed={r.present === false}
                      onClick={() => onMark(r, r.present === false ? null : false)}
                      className={`h-11 rounded-xl px-4 text-sm font-bold ${r.present === false ? "bg-ink text-white" : "border border-line bg-white"}`}
                    >
                      No vino
                    </button>
                  )}
                  {r.kind === "visitante" && (
                    <button type="button" onClick={() => onMark(r, null)} aria-label={`Quitar a ${r.name}`} className="h-11 rounded-xl px-3 text-muted hover:text-accent-text">
                      ✕
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {(
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!guest.trim()) return;
              onAddGuest(guest, guestRole);
              setGuest("");
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={guest}
              onChange={(e) => setGuest(e.target.value)}
              placeholder={canMark ? "Vino alguien sin abono" : "Apuntar a alguien sin abono"}
              aria-label="Nombre de alguien sin abono"
              className="h-11 w-56 rounded-xl border border-line px-3 text-sm outline-none focus:border-ink"
            />
            {usesRoles && (
              <select
                value={guestRole}
                onChange={(e) => setGuestRole(e.target.value)}
                aria-label="Rol"
                className="h-11 rounded-xl border border-line bg-white px-2 text-sm"
              >
                <option value="none">Rol</option>
                <option value="leader">Leader</option>
                <option value="follower">Follower</option>
              </select>
            )}
            <button type="submit" className="h-11 rounded-xl border border-line px-3 text-sm font-bold">
              + Añadir
            </button>
          </form>
          {canMark && rows.some((r) => r.kind !== "visitante" && r.present !== true) && (
            <button type="button" onClick={onMarkAll} className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
              Todos vinieron
            </button>
          )}
        </div>
      )}
      {!canMark && (
        <p className="mt-2 text-xs text-muted">
          Puedes apuntar a alguien que vendrá (p. ej. a probar o pagó en efectivo). La asistencia se marca el día de la clase.
        </p>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "blue" | "orange" | "gray"; children: React.ReactNode }) {
  const cls =
    tone === "blue" ? "bg-[#e6ecfb] text-[#2950c4]" : tone === "orange" ? "bg-[#fdefd9] text-few-text" : "bg-paper text-muted";
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}
