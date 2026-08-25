import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the request shapes for the Instagram-login API. These are exactly
 * the details that differ from the Facebook-login flow, so a regression here
 * would only surface as a 404 or "invalid recipient" against live Meta —
 * long after deploy.
 */

const ORIGINAL = { ...process.env };

function mockFetch(response: object, ok = true) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
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

describe("sendPrivateReply", () => {
  it("posts to /me/messages with a comment_id recipient", async () => {
    const spy = mockFetch({ recipient_id: "IGSID-123", message_id: "mid-1" });
    const { sendPrivateReply } = await import("../instagram");

    const out = await sendPrivateReply("comment-99", "olá");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/v26.0/me/messages");

    const body = JSON.parse(init.body);
    // The defining difference from the Facebook-login flow: the recipient is
    // a comment, and there is no /private_replies path.
    expect(body.recipient).toEqual({ comment_id: "comment-99" });
    expect(url).not.toContain("private_replies");
    expect(url).not.toContain("graph.facebook.com");

    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(out).toEqual({ recipientId: "IGSID-123", messageId: "mid-1" });
  });

  it("surfaces the API error message", async () => {
    mockFetch({ error: { message: "Comment is too old" } }, false);
    const { sendPrivateReply } = await import("../instagram");
    await expect(sendPrivateReply("c1", "oi")).rejects.toThrow("Comment is too old");
  });

  it("honours IG_USER_ID when several accounts are managed", async () => {
    process.env.IG_USER_ID = "17841400000000000";
    const spy = mockFetch({ recipient_id: "x", message_id: "y" });
    const { sendPrivateReply } = await import("../instagram");

    await sendPrivateReply("c1", "oi");
    expect(spy.mock.calls[0][0]).toContain("/17841400000000000/messages");
  });
});

describe("fetchProfile", () => {
  it("reads profile_pic — asking for profile_picture_url fails the whole call", async () => {
    const spy = mockFetch({
      name: "Ana",
      username: "ana.demo",
      profile_pic: "https://cdn/x.jpg",
    });
    const { fetchProfile } = await import("../instagram");

    const p = await fetchProfile("IGSID-1");

    expect(spy.mock.calls[0][0]).toContain("fields=name,username,profile_pic");
    expect(p).toEqual({
      name: "Ana",
      username: "ana.demo",
      profilePic: "https://cdn/x.jpg",
    });
  });

  it("returns empty rather than throwing when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { fetchProfile } = await import("../instagram");
    await expect(fetchProfile("IGSID-1")).resolves.toEqual({});
  });
});

describe("sendSenderAction", () => {
  it("posts recipient and sender_action as top-level siblings, with no message key", async () => {
    const spy = mockFetch({ recipient_id: "IGSID-1" });
    const { sendSenderAction } = await import("../instagram");

    await sendSenderAction("IGSID-1", "mark_seen");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/v26.0/me/messages");
    expect(JSON.parse(init.body)).toEqual({
      recipient: { id: "IGSID-1" },
      sender_action: "mark_seen",
    });
  });

  it("never throws — a failed receipt must not cost the reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { sendSenderAction } = await import("../instagram");
    await expect(sendSenderAction("IGSID-1", "mark_seen")).resolves.toBeUndefined();
  });
});

describe("token configuration", () => {
  it("fails loudly when IG_ACCESS_TOKEN is missing", async () => {
    delete process.env.IG_ACCESS_TOKEN;
    mockFetch({});
    const { sendPrivateReply } = await import("../instagram");
    await expect(sendPrivateReply("c1", "oi")).rejects.toThrow(/IG_ACCESS_TOKEN/);
  });
});
