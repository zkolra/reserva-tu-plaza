"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DanceRole } from "./types";

export type SupabaseConfig = { url: string; key: string } | null;

export type Quote = {
  plan_id: string;
  plan_name: string;
  monthly_cents: number;
  start_on: string;
  period_end: string;
  sessions_total: number | null;
  sessions_left: number | null;
  first_cents: number;
  offer_next: boolean;
  next_start: string;
  next_cents: number;
};

export type MyMembership = {
  id: string;
  series: string[];
  role: DanceRole;
  autoRenew: boolean;
  endsOn: string | null;
  /** Pagado en la escuela (efectivo, transferencia…): no se cambia online */
  paidAtSchool: boolean;
};

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
  // null = no sabemos (sin sesión); true/false = respuesta de la base
  const [enrollmentDue, setEnrollmentDue] = useState<boolean | null>(null);
  const [trialAvailable, setTrialAvailable] = useState<boolean | null>(null);

  const loadMine = useCallback(async () => {
    if (!sb) return;
    sb.rpc("enrollment_due", { p_studio: studioId }).then(({ data, error }) => {
      setEnrollmentDue(error ? null : Boolean(data));
    });
    sb.rpc("trial_available", { p_studio: studioId }).then(({ data, error }) => {
      setTrialAvailable(error ? null : Boolean(data));
    });
    const { data: who } = await sb.auth.getUser();
    const { data } = await sb
      .from("memberships")
      .select("id, auto_renew, ends_on, payment_method, membership_series(series_id, role)")
      .eq("studio_id", studioId)
      .eq("user_id", who.user?.id ?? "")
      .eq("status", "active")
      .maybeSingle();
    if (!data) {
      setMine(null);
      return;
    }
    const rows = (data.membership_series ?? []) as { series_id: string; role: DanceRole }[];
    const withRole = rows.find((r) => r.role !== "none");
    setMine({
      id: data.id,
      series: rows.map((r) => r.series_id),
      role: withRole?.role ?? "follower",
      autoRenew: data.auto_renew,
      endsOn: data.ends_on,
      paidAtSchool: !!data.payment_method && data.payment_method !== "online",
    });
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
    else {
      setMine(null);
      setEnrollmentDue(null);
      setTrialAvailable(null);
    }
  }, [email, loadMine]);

  async function sendLink(address: string) {
    if (!sb) return "La base de datos no está conectada.";
    const redirect = window.location.href.split("#")[0];
    const { error } = await sb.auth.signInWithOtp({ email: address, options: { emailRedirectTo: redirect } });
    return error ? error.message : null;
  }

  async function save(seriesIds: string[], role: DanceRole, autoRenew: boolean, start: string | null = null) {
    if (!sb) return "La base de datos no está conectada.";
    const { error } = await sb.rpc("create_membership", {
      p_studio: studioId,
      p_series: seriesIds,
      p_role: role === "none" ? "follower" : role,
      p_auto_renew: autoRenew,
      ...(start ? { p_start: start } : {}),
    });
    if (error) return error.message;
    await loadMine();
    return null;
  }

  /** Reserva la clase de prueba; devuelve la fecha (AAAA-MM-DD) o un error. */
  async function bookTrial(seriesId: string, role: DanceRole): Promise<{ date?: string; error?: string }> {
    if (!sb) return { error: "La base de datos no está conectada." };
    const { data, error } = await sb.rpc("book_trial", {
      p_studio: studioId,
      p_series: seriesId,
      p_role: role === "none" ? "follower" : role,
    });
    if (error) return { error: error.message };
    await loadMine();
    return { date: data as string };
  }

  async function signOut() {
    await sb?.auth.signOut();
  }

  /** Precio del primer mes (si se empieza a mitad de mes) — null si la base aún no lo sabe calcular. */
  const quote = useCallback(
    async (seriesIds: string[], start: string | null) => {
      if (!sb || seriesIds.length === 0) return null;
      const { data, error } = await sb.rpc("quote_membership", { p_studio: studioId, p_series: seriesIds, p_start: start });
      if (error || !data) return null;
      return (Array.isArray(data) ? data[0] : data) as Quote;
    },
    [sb, studioId],
  );

  return { enabled: !!sb, ready, email, mine, enrollmentDue, trialAvailable, sendLink, save, bookTrial, signOut, quote };
}
