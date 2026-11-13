"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseConfig } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";
import LoginForm from "./LoginForm";

type Row = { role: string; studios: { name: string; slug: string } | null };

export default function AdminHome({ cfg }: { cfg: SupabaseConfig }) {
  const { sb, userId, email, ready } = useSession(cfg);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!sb || !userId) return;
    sb.rpc("is_platform_admin").then(({ data }) => setIsAdmin(!!data));
    sb.from("studio_staff")
      .select("role, studios(name, slug)")
      .eq("user_id", userId)
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [sb, userId]);

  if (!sb) return <p className="p-10">La base de datos no está conectada.</p>;
  if (!ready) return <p className="p-10 text-muted">Cargando…</p>;
  if (!email) return <LoginForm sb={sb} />;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold">Tus estudios</h1>
      <p className="mt-2 text-sm text-muted">
        Has entrado como {email} ·{" "}
        <button type="button" className="underline" onClick={() => sb.auth.signOut()}>
          Salir
        </button>
      </p>
      {isAdmin && (
        <Link
          href="/superadmin"
          className="mt-6 flex items-center justify-between rounded-2xl bg-ink p-5 font-bold text-white"
        >
          Superadmin: todas las escuelas
          <span className="text-sm font-semibold text-white/75">Abrir →</span>
        </Link>
      )}
      {rows === null ? (
        <p className="mt-8 text-muted">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 rounded-xl bg-white p-4 leading-relaxed">
          Todavía no formas parte del equipo de ningún estudio. Pide al propietario que te añada.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {rows.map((r) =>
            r.studios ? (
              <li key={r.studios.slug}>
                <Link
                  href={`/admin/${r.studios.slug}`}
                  className="flex items-center justify-between rounded-2xl bg-white p-5 font-bold hover:outline hover:outline-ink"
                >
                  {r.studios.name}
                  <span className="text-sm font-semibold text-muted">Abrir panel →</span>
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </main>
  );
}
