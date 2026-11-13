import { connection } from "next/server";
import { supabaseConfig } from "@/lib/config";
import SuperAdmin from "./SuperAdmin";

export const metadata = { title: "Superadmin · Reserva tu plaza" };

export default async function SuperAdminPage() {
  await connection(); // las variables se leen en cada petición
  return <SuperAdmin cfg={supabaseConfig()} />;
}
