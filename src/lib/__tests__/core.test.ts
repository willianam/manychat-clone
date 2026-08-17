import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { canSend, windowRemainingMs } from "../messaging-window";
import { verifySignature, verifyChallenge } from "../verify-signature";
import { validateGraph, findEntryNode, FlowGraph } from "../flow-schema";

const now = new Date("2026-08-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("messaging window", () => {
  it("allows a send inside 24h", () => {
    expect(canSend(hoursAgo(3), { now })).toEqual({ allowed: true });
  });

  it("blocks a send past 24h", () => {
    const d = canSend(hoursAgo(30), { now });
    expect(d.allowed).toBe(false);
  });

  it("blocks a contact who never messaged", () => {
    expect(canSend(null, { now }).allowed).toBe(false);
  });

  it("extends to 7 days with HUMAN_AGENT", () => {
    expect(canSend(hoursAgo(100), { tag: "HUMAN_AGENT", now }).allowed).toBe(true);
    expect(canSend(hoursAgo(200), { tag: "HUMAN_AGENT", now }).allowed).toBe(false);
  });

  it("reports remaining time, clamped at zero", () => {
    expect(windowRemainingMs(hoursAgo(23), now)).toBeGreaterThan(0);
    expect(windowRemainingMs(hoursAgo(25), now)).toBe(0);
  });
});

describe("webhook signature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ entry: [{ id: "1" }] });
  const sign = (b: string, s = secret) =>
    "sha256=" + crypto.createHmac("sha256", s).update(b, "utf8").digest("hex");

  it("accepts a valid signature", () => {
    expect(verifySignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(body + " ", sign(body), secret)).toBe(false);
  });

  it("rejects a signature from the wrong secret", () => {
    expect(verifySignature(body, sign(body, "other"), secret)).toBe(false);
  });

  it("rejects malformed or missing headers", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=zzzz", secret)).toBe(false);
    expect(verifySignature(body, "md5=abc", secret)).toBe(false);
  });

  it("echoes the challenge only on a token match", () => {
    const ok = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "tok",
      "hub.challenge": "42",
    });
    expect(verifyChallenge(ok, "tok")).toBe("42");
    expect(verifyChallenge(ok, "wrong")).toBeNull();
  });
});

describe("flow graph", () => {
  const good = {
    nodes: [
      { id: "a", type: "message" as const, position: { x: 0, y: 0 }, data: { kind: "message" as const, text: "hi" } },
      { id: "b", type: "end" as const, position: { x: 0, y: 1 }, data: { kind: "end" as const } },
    ],
    edges: [{ id: "e", source: "a", target: "b" }],
  };

  it("accepts a well-formed graph", () => {
    const parsed = FlowGraph.parse(good);
    expect(validateGraph(parsed).filter((i) => i.level === "error")).toHaveLength(0);
    expect(findEntryNode(parsed)).toBe("a");
  });

  it("flags an edge pointing at a missing node", () => {
    const g = FlowGraph.parse({ ...good, edges: [{ id: "e", source: "a", target: "ghost" }] });
    expect(validateGraph(g).some((i) => i.level === "error")).toBe(true);
  });

  it("requires both branches on a condition", () => {
    const g = FlowGraph.parse({
      nodes: [
        { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { kind: "condition", key: "k", op: "exists" } },
        { id: "b", type: "end", position: { x: 0, y: 1 }, data: { kind: "end" } },
      ],
      edges: [{ id: "e", source: "c", target: "b", sourceHandle: "true" }],
    });
    expect(validateGraph(g).some((i) => i.message.includes("true and a false"))).toBe(true);
  });

  it("detects a graph with no entry point", () => {
    const g = FlowGraph.parse({
      nodes: [
        { id: "a", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "x" } },
        { id: "b", type: "message", position: { x: 0, y: 1 }, data: { kind: "message", text: "y" } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    });
    expect(validateGraph(g).some((i) => i.message.includes("No entry node"))).toBe(true);
  });

  it("rejects an invalid saveAs identifier", () => {
    const bad = {
      nodes: [{ id: "q", type: "question", position: { x: 0, y: 0 }, data: { kind: "question", text: "?", saveAs: "9bad name" } }],
      edges: [],
    };
    expect(FlowGraph.safeParse(bad).success).toBe(false);
  });
});
