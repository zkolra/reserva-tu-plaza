import { connection } from "next/server";
import { supabaseConfig } from "@/lib/config";
import AdminHome from "./AdminHome";

export const metadata = { title: "Panel del estudio · Reserva tu plaza" };

export default async function AdminPage() {
  await connection(); // las variables se leen en cada petición
  return <AdminHome cfg={supabaseConfig()} />;
}
