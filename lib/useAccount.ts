"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DanceRole } from "./types";

export type SupabaseConfig = { url: string; key: string } | null;

export type MyMembership = { id: string; series: string[]; role: DanceRole };

let browserClient: SupabaseClient | null = null;
export function getBrowserClient(cfg: NonNullable<SupabaseConfig>) {
  if (!browserClient) browserClient = createClient(cfg.url, cfg.key);
  return browserClient;
}

/** Sesión del alumno (enlace por email) y su abono activo en este estudio. */
export function useAccount(cfg: SupabaseConfig, studioId: string) {
  const sb = useMemo(() => (cfg ? getBrowserClient(cfg) : null), [cfg]);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mine, setMine] = useState<MyMembership | null>(null);

  const loadMine = useCallback(async () => {
    if (!sb) return;
    const { data } = await sb
      .from("memberships")
      .select("id, membership_series(series_id, role)")
      .eq("studio_id", studioId)
      .eq("status", "active")
      .maybeSingle();
    if (!data) {
      setMine(null);
      return;
    }
    const rows = (data.membership_series ?? []) as { series_id: string; role: DanceRole }[];
    const withRole = rows.find((r) => r.role !== "none");
    setMine({ id: data.id, series: rows.map((r) => r.series_id), role: withRole?.role ?? "follower" });
  }, [sb, studioId]);

  useEffect(() => {
    if (!sb) {
      setReady(true);
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setReady(true);
      // Quitar el token del enlace del email de la barra de direcciones
      if (window.location.hash.includes("access_token")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (email) loadMine();
    else setMine(null);
  }, [email, loadMine]);

  async function sendLink(address: string) {
    if (!sb) return "La base de datos no está conectada.";
    const redirect = window.location.href.split("#")[0];
    const { error } = await sb.auth.signInWithOtp({ email: address, options: { emailRedirectTo: redirect } });
    return error ? error.message : null;
  }

  async function save(seriesIds: string[], role: DanceRole) {
    if (!sb) return "La base de datos no está conectada.";
    const { error } = await sb.rpc("create_membership", {
      p_studio: studioId,
      p_series: seriesIds,
      p_role: role === "none" ? "follower" : role,
    });
    if (error) return error.message;
    await loadMine();
    return null;
  }

  async function signOut() {
    await sb?.auth.signOut();
  }

  return { enabled: !!sb, ready, email, mine, sendLink, save, signOut };
}
