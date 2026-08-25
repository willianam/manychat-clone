/**
 * Structured logger, the minimum that pays for itself.
 *
 * In production every line is one JSON object — Vercel and Docker both
 * collect stdout, and JSON is what their log search can filter on. In dev
 * it is a readable line with the fields appended. Levels are gated by
 * LOG_LEVEL (debug | info | warn | error; default info).
 *
 * Errors passed as a field are flattened to {message, stack, name} so they
 * survive JSON.stringify, which would otherwise print `{}`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return ORDER[raw] ?? ORDER.info;
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Plain-data view of a value, so an Error inside `fields` is not lost. */
export function serializeField(v: unknown): unknown {
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack };
  }
  return v;
}

export function formatLine(
  level: LogLevel,
  scope: string,
  msg: string,
  fields?: LogFields,
): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = serializeField(v);

  if (isProd()) {
    return JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...out });
  }
  const extra = Object.keys(out).length ? " " + JSON.stringify(out) : "";
  return `[${scope}] ${msg}${extra}`;
}

function emit(level: LogLevel, scope: string, msg: string, fields?: LogFields): void {
  if (ORDER[level] < threshold()) return;
  const line = formatLine(level, scope, msg, fields);
  // console is the transport: stdout/stderr is what every host collects.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
};

/** A logger bound to a scope ("webhook", "worker", "instagram"). */
export function logger(scope: string): Logger {
  return {
    debug: (m, f) => emit("debug", scope, m, f),
    info: (m, f) => emit("info", scope, m, f),
    warn: (m, f) => emit("warn", scope, m, f),
    error: (m, f) => emit("error", scope, m, f),
  };
}
