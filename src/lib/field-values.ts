/**
 * Typed field values.
 *
 * Every contact field is stored as a string, so "typed" means two things:
 * a canonical spelling on write (so "1.500,00" and "1500" are the same
 * number later), and a comparison on read that knows what the strings are.
 * Both live here, pure, so the runner and the tests share one definition.
 */

export type FieldValueType = "text" | "number" | "date" | "boolean";

const FALSY_WORDS = new Set(["", "0", "false", "falso", "não", "nao", "no", "n", "off"]);

/**
 * Parse a number the way a Brazilian would type it, as well as the way a
 * machine would. Null when it is not a number at all.
 *
 *   "1500" · "1500.5" · "1.500,50" · "1500,50" · "R$ 1.500" → 1500 / 1500.5
 *
 * A bare "1.500" is read the Brazilian way (fifteen hundred): dots that
 * group exactly three digits, with no comma anywhere, are thousands
 * separators. "1.5" and "1500.5" keep their dot as a decimal point.
 */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/^r\$\s*/i, "").replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // A comma is the decimal separator; any dots before it are thousands.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a date as ISO ("2026-08-25", "2026-08-25T14:30") or as typed in
 * Brazil ("25/08/2026", "25/08/2026 14:30"). Returns epoch milliseconds, or
 * null. Date-only values are taken at UTC midnight on both forms, so two
 * dates compare by calendar day regardless of how they were spelled.
 */
export function parseDate(input: string): number | null {
  const s = input.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  let y: number, mo: number, d: number, h = 0, mi = 0, sec = 0;
  if (m && /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    // Full ISO with an explicit zone: let the platform parse it.
    if (/Z|[+-]\d{2}:?\d{2}$/.test(s) && s.includes("T")) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? null : t;
    }
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4]) [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4]) [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, sec);
  // Reject 31/02: Date.UTC would silently roll it into March.
  if (new Date(t).getUTCMonth() !== mo - 1) return null;
  return t;
}

/**
 * The canonical stored form of a value for its declared type.
 *
 * A value that does not parse as the declared type is stored as typed: the
 * flow author's data is not ours to destroy, and the condition side treats
 * unparseable values as plain text anyway.
 */
export function coerceFieldValue(value: string, type: FieldValueType): string {
  switch (type) {
    case "number": {
      const n = parseNumber(value);
      return n === null ? value : String(n);
    }
    case "date": {
      const t = parseDate(value);
      if (t === null) return value;
      const iso = new Date(t).toISOString();
      // Keep a date-only value date-only; a time-of-day keeps its time.
      return /\d:\d/.test(value) ? iso : iso.slice(0, 10);
    }
    case "boolean":
      return FALSY_WORDS.has(value.trim().toLowerCase()) ? "false" : "true";
    default:
      return value;
  }
}

export type OrderOp = "gt" | "lt" | "before" | "after";

/**
 * Ordered comparison of two stored values.
 *
 * `gt`/`lt` compare as numbers when both sides parse as numbers, as dates
 * when both parse as dates, and as text otherwise — so "9" < "10" and
 * "25/08/2026" < "2026-09-01" both come out the way a person expects.
 * `before`/`after` are date-only: anything that is not a date is false,
 * because "before" has no meaning for text and guessing would fire branches
 * at random.
 */
export function compareValues(op: OrderOp, raw: unknown, value: unknown): boolean {
  const a = String(raw ?? "");
  const b = String(value ?? "");

  if (op === "before" || op === "after") {
    const da = parseDate(a);
    const db = parseDate(b);
    if (da === null || db === null) return false;
    return op === "before" ? da < db : da > db;
  }

  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na !== null && nb !== null) return op === "gt" ? na > nb : na < nb;

  const da = parseDate(a);
  const db = parseDate(b);
  if (da !== null && db !== null) return op === "gt" ? da > db : da < db;

  const c = a.localeCompare(b, "pt-BR");
  return op === "gt" ? c > 0 : c < 0;
}
