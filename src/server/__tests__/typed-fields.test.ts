import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/** Guards that the runner actually uses the typed-field rules end to end. */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { startFlow } from "../flow-runner";

const CONTACT = "contact-1";
const FLOW = "flow-1";
const node = (id: string, data: object) => ({
  id, type: (data as { kind: string }).kind, position: { x: 0, y: 0 }, data,
});

/** action(setField total=1.500,00 as number) → condition(total gt 1499) → yes/no ends. */
const GRAPH = {
  nodes: [
    node("a1", { kind: "action", ops: [{ op: "setField", key: "total", value: "1.500,00", valueType: "number" }] }),
    node("c1", { kind: "condition", key: "total", op: "gt", value: "1499" }),
    node("yes", { kind: "tag", action: "add", tagName: "vip" }),
    node("no", { kind: "end" }),
    node("e1", { kind: "end" }),
  ],
  edges: [
    { id: "a1-c1", source: "a1", target: "c1" },
    { id: "c1-yes", source: "c1", target: "yes", sourceHandle: "true" },
    { id: "c1-no", source: "c1", target: "no", sourceHandle: "false" },
    { id: "yes-e1", source: "yes", target: "e1" },
  ],
};

function fakeDb() {
  const session = { id: "s1", flowId: FLOW, contactId: CONTACT, currentNodeId: null, status: "ACTIVE", context: {} };
  const write = ({ data }: { data: object }) => {
    Object.assign(session, data);
    return Promise.resolve({ ...session });
  };
  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: { findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph: GRAPH }) },
    flowSession: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(write), update: vi.fn(write) },
    contactField: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    tag: { upsert: vi.fn().mockResolvedValue({ id: "tag-vip", name: "vip" }) },
    contactTag: { upsert: vi.fn().mockResolvedValue({}) },
  };
  return { db: db as unknown as PrismaClient, raw: db, session };
}

describe("typed fields in the runner", () => {
  it("stores the canonical number and compares gt numerically", async () => {
    const { db, raw, session } = fakeDb();

    await startFlow(db, FLOW, CONTACT);

    expect(raw.contactField.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { contactId: CONTACT, key: "total", value: "1500" } }),
    );
    expect((session.context as Record<string, unknown>).total).toBe("1500");
    // As text, "1.500,00" > "1499" would have been false ("1" < "1"... then "." < "4").
    expect(raw.contactTag.upsert).toHaveBeenCalledTimes(1);
  });
});
