import { describe, it, expect, vi } from "vitest";
import {
  isBlockedHost,
  applySecrets,
  getPath,
  asFieldValue,
  runRequest,
  MAX_RESPONSE_BYTES,
  type RenderMode,
} from "../external-request";

const node = (over: object = {}) => ({
  kind: "request" as const,
  method: "GET" as const,
  url: "https://api.exemplo.com/x",
  ...over,
});
const raw = (t: string) => t;
const fetchJson = (body: unknown, init: { status?: number } = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: init.status ?? 200 }));

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local and internal names", () => {
    for (const h of [
      "localhost",
      "foo.localhost",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "::1",
      "[::1]",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "printer.local",
      "db.internal",
      "2130706433",
      "0x7f000001",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows public hosts", () => {
    for (const h of ["api.exemplo.com", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});

describe("applySecrets", () => {
  it("reads FLOW_SECRET_<NAME> and blanks unknown ones", () => {
    const env = { FLOW_SECRET_TOKEN: "abc" };
    expect(applySecrets("Bearer {{secret.TOKEN}}", env)).toBe("Bearer abc");
    expect(applySecrets("x{{ secret.NOPE }}y", env)).toBe("xy");
    expect(applySecrets("{{campo}}", env)).toBe("{{campo}}");
  });
});

describe("getPath / asFieldValue", () => {
  it("walks dots and brackets", () => {
    const v = { a: { b: [{ c: 5 }, { c: 6 }] }, s: "x" };
    expect(getPath(v, "a.b[1].c")).toBe(6);
    expect(getPath(v, "a.b.0.c")).toBe(5);
    expect(getPath(v, "s")).toBe("x");
    expect(getPath(v, "a.z.q")).toBeUndefined();
    expect(getPath("str", "a")).toBeUndefined();
  });

  it("stores scalars as text and objects as JSON", () => {
    expect(asFieldValue(5)).toBe("5");
    expect(asFieldValue(true)).toBe("true");
    expect(asFieldValue({ a: 1 })).toBe('{"a":1}');
    expect(asFieldValue(null)).toBeNull();
    expect(asFieldValue(undefined)).toBeNull();
  });
});

describe("runRequest", () => {
  it("GET with secret header, parses JSON on 2xx", async () => {
    const f = fetchJson({ ok: 1 });
    const r = await runRequest(
      node({ headers: [{ name: "Authorization", value: "Bearer {{secret.T}}" }] }),
      raw,
      f,
      { FLOW_SECRET_T: "tok" },
    );
    expect(r).toEqual({ ok: true, status: 200, json: { ok: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.exemplo.com/x");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.redirect).toBe("manual");
  });

  it("refuses a secret in the URL, and never fetches", async () => {
    const f = fetchJson({ ok: 1 });
    const r = await runRequest(
      node({ url: "https://api.exemplo.com/x?key={{secret.T}}" }),
      raw,
      f,
      { FLOW_SECRET_T: "tok" },
    );
    // A query-string secret leaks into access logs, proxy logs and Referer.
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("tok");
  });

  it("still allows the same secret in a header or the body", async () => {
    const f = fetchJson({ ok: 1 });
    const r = await runRequest(
      node({
        method: "POST",
        body: '{"k":"{{secret.T}}"}',
        headers: [{ name: "X-Key", value: "{{secret.T}}" }],
      }),
      raw,
      f,
      { FLOW_SECRET_T: "tok" },
    );
    expect(r.ok).toBe(true);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Key"]).toBe("tok");
    expect(init.body).toBe('{"k":"tok"}');
  });

  it("POST sends the rendered body as JSON", async () => {
    const f = fetchJson({});
    const render = (t: string, m: RenderMode) => (m === "json" ? t.replace("{{n}}", "Ana") : t);
    await runRequest(node({ method: "POST", body: '{"name":"{{n}}"}' }), render, f, {});
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"Ana"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("refuses blocked hosts and non-http schemes without calling fetch", async () => {
    const f = fetchJson({});
    expect((await runRequest(node({ url: "http://169.254.169.254/latest" }), raw, f, {})).ok).toBe(
      false,
    );
    expect((await runRequest(node({ url: "file:///etc/passwd" }), raw, f, {})).ok).toBe(false);
    expect((await runRequest(node({ url: "nope" }), raw, f, {})).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("a non-2xx is an error with the status", async () => {
    const r = await runRequest(node(), raw, fetchJson({ e: 1 }, { status: 500 }), {});
    expect(r).toEqual({ ok: false, status: 500, reason: "HTTP 500" });
  });

  it("a network failure is an error, not a throw", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await runRequest(node(), raw, f, {})).toEqual({ ok: false, reason: "ECONNRESET" });
  });

  it("caps the body at 256 KB", async () => {
    const big = "x".repeat(MAX_RESPONSE_BYTES + 5000);
    const f = vi.fn(async () => new Response(big, { status: 200 }));
    const r = await runRequest(node(), raw, f, {});
    expect(r.ok).toBe(true);
    expect(String((r as { json: unknown }).json).length).toBe(MAX_RESPONSE_BYTES);
  });

  it("non-JSON text is kept as text", async () => {
    const f = vi.fn(async () => new Response("pong", { status: 200 }));
    expect(await runRequest(node(), raw, f, {})).toEqual({ ok: true, status: 200, json: "pong" });
  });
});
