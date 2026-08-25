/**
 * Chart colors, taken from the app's own tokens (globals.css) so a chart
 * looks like the rest of the panel. Validated with the dataviz palette
 * checker in light mode on a white surface: lightness band, chroma floor,
 * adjacent-pair CVD separation, normal-vision floor and 3:1 contrast all
 * pass for the four series in this order — the order is the CVD-safety
 * mechanism, so assign slots in sequence and never cycle past four.
 *
 * "Other" is a deliberate non-series: gray, always last, always labelled.
 */
export const SERIES = ["#4f46e5", "#0d9488", "#d97706", "#e11d48"] as const; // indigo-600, teal-600, amber-600, rose-600
export const OTHER = "#a3a3a3"; // neutral-400
export const GRID = "#e5e5e5"; // neutral-200, hairline
export const AXIS_TEXT = "#737373"; // neutral-500

/** Series slots by index, folding anything past the fourth into "other". */
export function seriesColor(i: number): string {
  return SERIES[i] ?? OTHER;
}
