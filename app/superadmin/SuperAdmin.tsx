"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";
import LoginForm from "../admin/LoginForm";

type StudioRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  owners: string | null;
  invited: string | null;
  classes: number;
  active_memberships: number;
  trials: number;
};

/** «Escuela de Salsa Barcelona» → «escuela-de-salsa-barcelona» */
function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function SuperAdmin({ cfg }: { cfg: SupabaseConfig }) {
  const { sb, userId, email, ready } = useSession(cfg);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!sb || !userId) return;
    sb.rpc("is_platform_admin").then(({ data }) => setIsAdmin(!!data));
  }, [sb, userId]);

  if (!sb) return <p className="p-10">La base de datos no está conectada.</p>;
  if (!ready) return <p className="p-10 text-muted">Cargando…</p>;
  if (!email) return <LoginForm sb={sb} />;
  if (isAdmin === null) return <p className="p-10 text-muted">Cargando…</p>;
  if (!isAdmin)
    return (
      <main className="mx-auto max-w-md px-6 py-20">
        <h1 className="font-display text-2xl font-bold">Sin acceso</h1>
        <p className="mt-3 text-muted">
          Esta página es solo para el administrador de la plataforma.{" "}
          <Link href="/admin" className="underline">
            Ir al panel del estudio
          </Link>
        </p>
      </main>
    );

  return <Dashboard sb={sb} email={email} />;
}

function Dashboard({ sb, email }: { sb: SupabaseClient; email: string }) {
  const [rows, setRows] = useState<StudioRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc("platform_studios");
    if (error) setError(error.message);
    setRows((data ?? []) as StudioRow[]);
  }, [sb]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = (rows ?? []).reduce(
    (t, r) => ({ schools: t.schools + 1, members: t.members + r.active_memberships, trials: t.trials + r.trials }),
    { schools: 0, members: 0, trials: 0 },
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="font-display text-lg font-bold">Reserva tu plaza · Superadmin</div>
          <div className="flex items-center gap-3 text-xs text-white/75">
            {email}
            <button type="button" className="underline" onClick={() => sb.auth.signOut()}>
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Escuelas</h1>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent"
            >
              + Nueva escuela
            </button>
          )}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <Kpi label="Escuelas" value={rows ? String(totals.schools) : "…"} />
          <Kpi label="Abonos activos (total)" value={rows ? String(totals.members) : "…"} />
          <Kpi label="Clases de prueba (total)" value={rows ? String(totals.trials) : "…"} />
        </div>

        {error && <ErrorBox text={error} />}
        {creating && (
          <CreateStudio
            sb={sb}
            onDone={() => {
              setCreating(false);
              load();
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="flex flex-col gap-3">
          {rows && rows.length === 0 && <p className="rounded-2xl bg-white p-5 text-muted">Todavía no hay escuelas.</p>}
          {(rows ?? []).map((r) => (
            <StudioCard key={r.id} sb={sb} row={r} onChanged={load} />
          ))}
        </div>
      </main>
    </div>
  );
}

function CreateStudio({ sb, onDone, onCancel }: { sb: SupabaseClient; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sb.rpc("create_studio", { p_name: name, p_slug: slug, p_owner_email: owner });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border-2 border-ink bg-white p-5">
      <h2 className="text-lg font-bold">Nueva escuela</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <Field label="Nombre de la escuela">
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            className={inputCls}
          />
        </Field>
        <Field label="Dirección del horario">
          <div className="flex items-center rounded-xl border border-line focus-within:border-ink">
            <span className="pl-3 text-sm text-muted">…/</span>
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              className="h-11 w-full rounded-xl bg-transparent px-1 text-sm outline-none"
            />
          </div>
        </Field>
        <Field label="Email del dueño">
          <input type="email" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="opcional" className={inputCls} />
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Se crea con clase de prueba (10 €) y abonos de 1, 2 y 3 clases (35 / 60 / 85 €); el dueño los cambia en su
        panel. Si el dueño aún no tiene cuenta, recibe acceso automáticamente la primera vez que entre en /admin con ese
        email.
      </p>
      {error && <ErrorBox text={error} />}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent disabled:opacity-40">
          {busy ? "Creando…" : "Crear escuela"}
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-5 text-sm font-bold">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function StudioCard({ sb, row, onChanged }: { sb: SupabaseClient; row: StudioRow; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error } = await sb.rpc("add_studio_member", { p_studio: row.id, p_email: memberEmail, p_role: "owner" });
    if (error) {
      setError(error.message);
      return;
    }
    setMsg(data === "added" ? "Acceso dado ✓" : "Invitación guardada ✓ Tendrá acceso al entrar en /admin con ese email.");
    setMemberEmail("");
    setAdding(false);
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar «${row.name}» con todas sus clases, alumnos y abonos? No se puede deshacer.`)) return;
    if (window.prompt(`Para confirmar, escribe la dirección: ${row.slug}`) !== row.slug) return;
    const { error } = await sb.from("studios").delete().eq("id", row.id);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold">{row.name}</div>
          <div className="text-sm text-muted">/{row.slug}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/${row.slug}`} className="flex h-10 items-center rounded-lg bg-ink px-3 text-sm font-bold text-white">
            Abrir panel
          </Link>
          <Link href={`/${row.slug}`} target="_blank" className="flex h-10 items-center rounded-lg border border-line px-3 text-sm font-bold">
            Ver horario ↗
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <b>{row.classes}</b> clases
        </span>
        <span>
          <b>{row.active_memberships}</b> abonos activos
        </span>
        <span>
          <b>{row.trials}</b> clases de prueba
        </span>
        <span className="text-muted">Creada el {new Date(row.created_at).toLocaleDateString("es-ES")}</span>
      </div>

      <div className="text-sm">
        <span className="font-semibold">Dueños: </span>
        {row.owners || <span className="text-muted">nadie todavía</span>}
        {row.invited && <span className="text-muted"> · invitados: {row.invited}</span>}
      </div>

      {msg && <p className="text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <ErrorBox text={error} />}

      <div className="flex flex-wrap items-center gap-3">
        {adding ? (
          <form onSubmit={addMember} className="flex flex-wrap items-end gap-2">
            <Field label="Email">
              <input type="email" required value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} className={`${inputCls} w-64`} />
            </Field>
            <button type="submit" className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white">
              Dar acceso
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-11 px-2 text-sm underline">
              Cancelar
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold underline">
            + Dar acceso a alguien
          </button>
        )}
        <button type="button" onClick={remove} className="ml-auto text-sm text-muted underline hover:text-accent-text">
          Eliminar escuela
        </button>
      </div>
    </div>
  );
}

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
  return <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">{text}</p>;
}
