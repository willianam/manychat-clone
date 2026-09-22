import { describe, it, expect } from "vitest";
import { clientIp } from "../client-ip";

const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

/** A deployment that declares a trusted proxy in front of it. */
const trusted = { TRUST_PROXY: "1" } as NodeJS.ProcessEnv;
/** The bare `npm run start` container: nothing rewrites the header. */
const bare = {} as NodeJS.ProcessEnv;

describe("clientIp behind a trusted proxy", () => {
  it("takes the LAST x-forwarded-for entry, not the client-controlled first", () => {
    // The attacker seeds the header; our proxy appends the real address.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), trusted)).toBe("9.9.9.9");
  });

  it("a spoofed chain cannot mint a fresh bucket per request", () => {
    const real = "203.0.113.7";
    const keys = ["evil-1", "evil-2", "evil-3"].map((spoof) =>
      clientIp(h({ "x-forwarded-for": `${spoof}, ${real}` }), trusted),
    );
    // All three requests key to the same bucket — the limiter still bites.
    expect(new Set(keys)).toEqual(new Set([real]));
  });

  it("handles a single hop, odd spacing and missing headers", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }), trusted)).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": " 1.1.1.1 ,  2.2.2.2 " }), trusted)).toBe("2.2.2.2");
    expect(clientIp(h({}), trusted)).toBe("untrusted");
    expect(clientIp(h({ "x-forwarded-for": "" }), trusted)).toBe("untrusted");
    expect(clientIp(h({ "x-forwarded-for": " , " }), trusted)).toBe("untrusted");
  });
});

describe("clientIp with no trusted proxy", () => {
  it("ignores x-forwarded-for entirely", () => {
    // Self-hosted on bare `npm run start`: the whole chain is attacker input,
    // last entry included. Honouring it gave unlimited password attempts.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), bare)).toBe("untrusted");
  });

  it("collapses every spoofed value into one shared bucket", () => {
    const keys = ["a", "b", "c"].map((spoof) =>
      clientIp(h({ "x-forwarded-for": `1.1.1.1, ${spoof}` }), bare),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("still trusts x-vercel-forwarded-for, which the client cannot append to", () => {
    expect(
      clientIp(h({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "1.2.3.4" }), bare),
    ).toBe("203.0.113.5");
  });

  it("treats VERCEL=1 as a trusted proxy", () => {
    expect(
      clientIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { VERCEL: "1" } as NodeJS.ProcessEnv),
    ).toBe("9.9.9.9");
  });
});
