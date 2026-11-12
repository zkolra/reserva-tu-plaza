import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-6 py-20">
      <h1 className="font-display text-4xl font-bold">Reserva tu plaza</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Reservas y pagos para escuelas de baile, profes y estudios, integrados en tu propia web.
      </p>
      <Link
        href="/demo"
        className="mt-8 inline-flex h-13 w-fit items-center rounded-2xl bg-accent px-6 font-bold text-white"
      >
        Ver el horario de ejemplo
      </Link>
    </main>
  );
}
