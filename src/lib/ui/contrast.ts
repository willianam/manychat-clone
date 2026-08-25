/**
 * Pick a readable text color for an arbitrary background.
 *
 * Tag colors come from a color input, so they can be anything from pale
 * yellow to black. White text on `#fde047` is unreadable, so the text color
 * follows the background's WCAG relative luminance instead of being fixed.
 */

const DARK = "#171717";
const LIGHT = "#ffffff";

/** Parse `#rgb` / `#rrggbb` into 0–255 channels; null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors; null when either fails to parse. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Whichever of near-black or white contrasts more with `background`.
 * Unparseable input falls back to dark text, the safe choice on the light
 * neutral the chip would otherwise render on.
 */
export function readableTextColor(background: string): string {
  const dark = contrastRatio(background, DARK);
  const light = contrastRatio(background, LIGHT);
  if (dark === null || light === null) return DARK;
  return dark >= light ? DARK : LIGHT;
}
