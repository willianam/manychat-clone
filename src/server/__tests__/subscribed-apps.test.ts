import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/me/subscribed_apps` é o passo que falha em silêncio: sem ele o webhook
 * verifica com 200 e evento nenhum chega. Estes testes guardam duas coisas —
 * a forma exata da chamada (host, caminho, campos) e o fato de a recusa da
 * Meta virar uma frase que diz qual das causas é a desta máquina.
 */

const ORIGINAL = { ...process.env };

vi.mock("../db", () => ({
  db: {
    igCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create }: { create: object }) => ({
        expiresAt: null,
        refreshedAt: null,
        lastError: null,
        ...create,
      })),
    },
  },
}));

function mockFetch(response: object, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  process.env.IG_ACCESS_TOKEN = "test-token";
  process.env.GRAPH_API_VERSION = "v26.0";
  delete process.env.IG_USER_ID;
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("subscribeApp", () => {
  it("posta em /me/subscribed_apps com os campos que o app processa", async () => {
    const spy = mockFetch({ success: true });
    const { subscribeApp, SUBSCRIBED_FIELDS } = await import("../subscribed-apps");

    const out = await subscribeApp();

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/v26.0/me/subscribed_apps");
    expect(url).not.toContain("graph.facebook.com");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(init.body).subscribed_fields).toBe(SUBSCRIBED_FIELDS.join(","));

    expect(out).toEqual({ ok: true, fields: [...SUBSCRIBED_FIELDS] });
  });

  it("diz que falta permissão, e qual, quando a Meta recusa com o código 10", async () => {
    mockFetch({ error: { message: "(#10) Application does not have permission", code: 10 } }, 403);
    const { subscribeApp } = await import("../subscribed-apps");

    const out = await subscribeApp();

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("instagram_business_manage_messages");
    // A mensagem crua da Meta segue junto, para quem for pesquisar.
    expect(out.error).toContain("does not have permission");
  });

  it("separa token expirado de token sem permissão", async () => {
    mockFetch({ error: { message: "Session has expired", code: 190, error_subcode: 463 } }, 401);
    const { subscribeApp } = await import("../subscribed-apps");

    const out = await subscribeApp();

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("expirou");
    expect(out.error).toContain("IG_ACCESS_TOKEN");
    expect(out.error).not.toContain("instagram_business_manage_messages");
  });

  it("aponta a conta não-profissional como causa própria", async () => {
    mockFetch({ error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }, 400);
    const { subscribeApp } = await import("../subscribed-apps");

    const out = await subscribeApp();

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("conta profissional");
  });

  it("não deixa uma falha de rede escapar como exceção", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const { subscribeApp } = await import("../subscribed-apps");

    const out = await subscribeApp();

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Meta");
  });

  it("não chama a Meta sem token", async () => {
    delete process.env.IG_ACCESS_TOKEN;
    const spy = mockFetch({ success: true });
    const { subscribeApp } = await import("../subscribed-apps");

    const out = await subscribeApp();

    expect(spy).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("IG_ACCESS_TOKEN");
  });
});

describe("getSubscribedApps", () => {
  it("lê os campos inscritos e aponta os que faltam", async () => {
    mockFetch({ data: [{ subscribed_fields: ["messages", "comments"] }] });
    const { getSubscribedApps } = await import("../subscribed-apps");

    const out = await getSubscribedApps();

    expect(out.status).toBe("subscribed");
    if (out.status !== "subscribed") return;
    expect(out.fields).toEqual(["messages", "comments"]);
    expect(out.missing).toContain("messaging_postbacks");
  });

  it("data vazia é não inscrita, não é erro", async () => {
    mockFetch({ data: [] });
    const { getSubscribedApps } = await import("../subscribed-apps");

    expect((await getSubscribedApps()).status).toBe("not_subscribed");
  });

  it("uma recusa da Meta vira 'não sei', com o motivo — nunca 'está tudo certo'", async () => {
    mockFetch({ error: { message: "Session has expired", code: 190, error_subcode: 463 } }, 401);
    const { getSubscribedApps } = await import("../subscribed-apps");

    const out = await getSubscribedApps();

    expect(out.status).toBe("unknown");
    if (out.status !== "unknown") return;
    expect(out.reason).toContain("expirou");
  });
});
