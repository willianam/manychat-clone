import type { FlowNodeData } from "../lib/flow-schema";

/**
 * Executes a `request` node.
 *
 * Three guards, because this is the one node that lets a flow author reach
 * the network from our server:
 *
 *  - SSRF: the URL must be http(s) and must not name a loopback, private or
 *    link-local address, nor a `.local`/`.internal`/`localhost` host. The
 *    check is on the literal host only — DNS is not resolved here, so a
 *    public name that resolves to a private address is not caught.
 *  - Time: 10 seconds, then abort. The webhook has a 15s budget.
 *  - Size: replies are read up to 256 KB and cut there.
 *
 * Secrets: `{{secret.NOME}}` is replaced from env `FLOW_SECRET_NOME` before
 * the ordinary `{{campo}}` pass, so a contact's answer that happens to
 * contain "{{secret.X}}" is never expanded.
 */

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 256 * 1024;

export type RequestNode = Extract<FlowNodeData, { kind: "request" }>;

/** How a template value must be escaped for where it is going. */
export type RenderMode = "raw" | "url" | "json";
export type Render = (text: string, mode: RenderMode) => string;

export type RequestOutcome =
  { ok: true; status: number; json: unknown } | { ok: false; status?: number; reason: string };

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** True when the hostname must not be fetched from this server. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;

  // IPv6 literals arrive bracketed from URL.hostname.
  const v6 = h.startsWith("[") ? h.slice(1, -1) : h.includes(":") ? h : null;
  if (v6 !== null) {
    if (v6 === "::" || v6 === "::1") return true;
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isBlockedHost(mapped[1]!) : false;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return PRIVATE_V4.some((re) => re.test(h));
  // A bare number or hex form ("2130706433", "0x7f000001") is an IP in
  // disguise; refuse anything numeric that is not dotted-quad.
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true;
  return false;
}

/** Replace `{{secret.NAME}}` from env. Unknown secrets render as "". */
export function applySecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(
    /\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_m, name: string) => env[`FLOW_SECRET_${name}`] ?? "",
  );
}

/**
 * Read `a.b[0].c` out of a parsed JSON value. Undefined when any step is
 * missing. Only dots and numeric brackets: enough for real APIs, small
 * enough to reason about.
 */
export function getPath(value: unknown, path: string): unknown {
  const steps = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s !== "");
  let cur: unknown = value;
  for (const step of steps) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[step];
  }
  return cur;
}

/** A mapped value as a contact field: scalars as text, anything else as JSON. */
export function asFieldValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Read a body up to MAX_RESPONSE_BYTES, dropping the rest. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_RESPONSE_BYTES));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.byteLength - off);
    all.set(c.subarray(0, take), off);
    off += take;
    if (off >= all.byteLength) break;
  }
  return new TextDecoder().decode(all);
}

export async function runRequest(
  d: RequestNode,
  render: Render,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RequestOutcome> {
  const url = render(applySecrets(d.url, env), "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `URL inválida: ${url}` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `Só http(s): ${parsed.protocol}` };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: `Destino bloqueado: ${parsed.hostname}` };
  }

  const headers: Record<string, string> = {};
  for (const h of d.headers ?? []) headers[h.name] = render(applySecrets(h.value, env), "raw");
  let body: string | undefined;
  if (d.method === "POST" && d.body) {
    body = render(applySecrets(d.body, env), "json");
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(parsed.toString(), {
      method: d.method,
      headers,
      body,
      signal: ctl.signal,
      redirect: "manual", // a redirect to an internal host must not be followed
    });
    const text = await readCapped(res);
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    return { ok: true, status: res.status, json };
  } catch (err) {
    const reason = ctl.signal.aborted
      ? "timeout"
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
