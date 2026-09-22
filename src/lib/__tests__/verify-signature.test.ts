import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifySignature, verifyChallenge } from "../verify-signature";

const sign = (body: string, secret: string) =>
  `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifySignature", () => {
  const body = '{"object":"instagram","entry":[]}';

  it("accepts a body signed with the configured secret", () => {
    expect(verifySignature(body, sign(body, "s3cr3t"), "s3cr3t")).toBe(true);
  });

  it("rejects a body signed with another secret", () => {
    expect(verifySignature(body, sign(body, "outro"), "s3cr3t")).toBe(false);
  });

  it("rejects everything when the secret is empty — an empty HMAC key is not a key", () => {
    // Without this guard an unset IG_APP_SECRET let anyone compute
    // HMAC-SHA256(body, "") and drive the whole webhook pipeline.
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
    expect(verifySignature(body, sign(body, "s3cr3t"), "")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifySignature(body, null, "s3cr3t")).toBe(false);
    expect(verifySignature(body, "sha1=abc", "s3cr3t")).toBe(false);
  });
});

describe("verifyChallenge", () => {
  const params = (token: string) =>
    new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": "1234",
    });

  it("echoes the challenge when the token matches", () => {
    expect(verifyChallenge(params("tok"), "tok")).toBe("1234");
  });

  it("refuses when the token differs", () => {
    expect(verifyChallenge(params("errado"), "tok")).toBeNull();
  });

  it("refuses when the configured token is empty, even if the caller sends empty too", () => {
    // Otherwise a stranger registers our URL as their own webhook.
    expect(verifyChallenge(params(""), "")).toBeNull();
  });
});
