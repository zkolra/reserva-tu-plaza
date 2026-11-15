import Link from "next/link";
import StudioLogo from "./StudioLogo";

/** Cabecera de las páginas públicas de una escuela, con sus secciones. */
export default function StudioHeader({
  name,
  logoUrl,
  slug,
  showPrivate,
  current,
}: {
  name: string;
  logoUrl: string | null;
  slug: string;
  showPrivate: boolean;
  current: "horario" | "particulares";
}) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex h-10 items-center rounded-xl px-3 text-sm font-bold ${on ? "bg-white/15 text-white" : "text-white/75 hover:text-white"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="bg-ink text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <StudioLogo name={name} logoUrl={logoUrl} />
          <div className="font-bold">{name}</div>
        </div>
        {showPrivate && (
          <nav aria-label="Secciones" className="flex gap-1">
            {link(`/${slug}`, "Clases en grupo", current === "horario")}
            {link(`/${slug}/particulares`, "Clases particulares", current === "particulares")}
          </nav>
        )}
      </div>
    </header>
  );
}
