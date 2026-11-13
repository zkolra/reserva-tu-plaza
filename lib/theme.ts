import type { CSSProperties } from "react";

export const DEFAULT_ACCENT = "#b8235a";

/** Combinaciones listas: todas se leen bien con texto blanco encima. */
export const THEME_PRESETS: { key: string; name: string; accent: string }[] = [
  { key: "frambuesa", name: "Frambuesa", accent: "#b8235a" },
  { key: "rojo", name: "Rojo", accent: "#c0262d" },
  { key: "naranja", name: "Naranja", accent: "#c2410c" },
  { key: "verde", name: "Verde", accent: "#15803d" },
  { key: "turquesa", name: "Turquesa", accent: "#0f766e" },
  { key: "azul", name: "Azul", accent: "#1d4ed8" },
  { key: "morado", name: "Morado", accent: "#6d28d9" },
  { key: "negro", name: "Negro", accent: "#1e1b24" },
];

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : DEFAULT_ACCENT.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
}

/** Luminancia relativa (WCAG). */
function luminance([r, g, b]: RGB) {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Variables CSS del tema a partir del color principal.
 * - texto sobre el color: blanco u oscuro, el que se lea mejor
 * - texto de color sobre fondo claro: se oscurece hasta leerse bien
 */
export function themeVars(accent: string | null | undefined): CSSProperties {
  const base = toRgb(accent || DEFAULT_ACCENT);
  const hex = toHex(base);
  const white: RGB = [255, 255, 255];
  const ink: RGB = [30, 27, 36];

  const onAccent = contrast(hex, "#ffffff") >= 3 ? "#ffffff" : "#1e1b24";

  let text = base;
  for (let i = 0; i < 10 && contrast(toHex(text), "#ffffff") < 4.5; i++) text = mix(text, ink, 0.2);

  return {
    "--color-accent": hex,
    "--color-accent-soft": toHex(mix(base, white, 0.88)),
    "--color-on-accent": onAccent,
    "--color-accent-text": toHex(text),
  } as CSSProperties;
}
