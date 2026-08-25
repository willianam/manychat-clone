import { describe, it, expect } from "vitest";
import { authSecret, constantTimeEqual, signToken, verifyToken, SESSION_TTL_MS } from "../auth-token";
import { LoginRateLimiter } from "../login-rate-limit";

const NOW = Date.parse("2026-08-25T12:00:00Z");
const SECRET = "test-secret";

describe("session token", () => {
  it("round-trips: a token signed now verifies until its expiry", async () => {
    const exp = NOW + SESSION_TTL_MS;
    const token = await signToken(SECRET, exp);

    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(await verifyToken(SECRET, token, NOW)).toBe(true);
    expect(await verifyToken(SECRET, token, exp - 1)).toBe(true);
  });

  it("expires", async () => {
    const exp = NOW + 1000;
    const token = await signToken(SECRET, exp);
    expect(await verifyToken(SECRET, token, exp)).toBe(false);
    expect(await verifyToken(SECRET, token, exp + 1)).toBe(false);
  });

  it("rejects a token whose expiry was moved forward", async () => {
    const token = await signToken(SECRET, NOW + 1000);
    const [, sig] = token.split(".");
    expect(await verifyToken(SECRET, `${NOW + 999999999}.${sig}`, NOW)).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signToken("other", NOW + 1000);
    expect(await verifyToken(SECRET, token, NOW)).toBe(false);
  });

  it("rejects malformed and missing tokens without throwing", async () => {
    for (const bad of [undefined, "", "abc", "123", ".abc", "123.", "123.zz", `${NOW + 1}.${"0".repeat(63)}`]) {
      expect(await verifyToken(SECRET, bad, NOW), String(bad)).toBe(false);
    }
  });

  it("never treats the raw password as a valid cookie", async () => {
    // The old scheme: cookie === ADMIN_PASSWORD. It must not verify now.
    expect(await verifyToken(authSecret({ ADMIN_PASSWORD: "hunter2" })!, "hunter2", NOW)).toBe(false);
  });
});

describe("authSecret", () => {
  it("prefers AUTH_SECRET, derives from ADMIN_PASSWORD otherwise, null with neither", () => {
    expect(authSecret({ AUTH_SECRET: "s", ADMIN_PASSWORD: "p" })).toBe("s");
    const derived = authSecret({ ADMIN_PASSWORD: "p" });
    expect(derived).not.toBeNull();
    expect(derived).not.toBe("p"); // salted, so the password is never the raw key
    expect(authSecret({})).toBeNull();
  });
});

describe("constantTimeEqual", () => {
  it("compares strings of any length", async () => {
    expect(await constantTimeEqual("senha", "senha")).toBe(true);
    expect(await constantTimeEqual("senha", "senhb")).toBe(false);
    expect(await constantTimeEqual("senha", "senha ")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
  });
});

describe("LoginRateLimiter", () => {
  it("allows five failures, blocks the sixth, and forgets after the window", () => {
    const rl = new LoginRateLimiter(5, 15 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      expect(rl.allows("1.2.3.4", NOW)).toBe(true);
      rl.recordFailure("1.2.3.4", NOW + i);
    }
    expect(rl.allows("1.2.3.4", NOW + 10)).toBe(false);
    expect(rl.allows("5.6.7.8", NOW + 10)).toBe(true); // another IP is unaffected
    expect(rl.allows("1.2.3.4", NOW + 15 * 60 * 1000)).toBe(true);
  });

  it("clears on a successful login", () => {
    const rl = new LoginRateLimiter(2, 1000);
    rl.recordFailure("ip", NOW);
    rl.recordFailure("ip", NOW);
    expect(rl.allows("ip", NOW)).toBe(false);
    rl.reset("ip");
    expect(rl.allows("ip", NOW)).toBe(true);
  });
});
