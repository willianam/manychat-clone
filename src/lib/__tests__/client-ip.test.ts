import { describe, it, expect } from "vitest";
import { clientIp } from "../client-ip";

const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe("clientIp", () => {
  it("takes the LAST x-forwarded-for entry, not the client-controlled first", () => {
    // The attacker seeds the header; our proxy appends the real address.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("a spoofed chain cannot mint a fresh bucket per request", () => {
    const real = "203.0.113.7";
    const keys = ["evil-1", "evil-2", "evil-3"].map((spoof) =>
      clientIp(h({ "x-forwarded-for": `${spoof}, ${real}` })),
    );
    // All three requests key to the same bucket — the limiter still bites.
    expect(new Set(keys)).toEqual(new Set([real]));
  });

  it("prefers x-vercel-forwarded-for, which the client cannot append to", () => {
    expect(
      clientIp(h({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "1.2.3.4" })),
    ).toBe("203.0.113.5");
  });

  it("handles a single hop, odd spacing and missing headers", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": " 1.1.1.1 ,  2.2.2.2 " }))).toBe("2.2.2.2");
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
