/* eslint-disable @next/next/no-img-element -- los logos vienen de Supabase Storage */

/** Logo del estudio; si no hay, la inicial sobre el color principal. */
export default function StudioLogo({
  name,
  logoUrl,
  size = 36,
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`Logo de ${name}`}
        style={{ height: size, maxWidth: size * 4 }}
        className="w-auto rounded-lg object-contain"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-xl bg-accent font-display text-sm font-bold text-on-accent"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
