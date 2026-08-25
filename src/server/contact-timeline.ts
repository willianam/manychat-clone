import type { ContactEventKind, PrismaClient, Prisma } from "@prisma/client";

/**
 * One contact's history, newest first: messages both ways, flow runs
 * (start, and end when completed or abandoned), owner notes and the
 * mutation events recorded by contact-events.ts.
 *
 * Four tables are merged in memory rather than through a UNION because the
 * rows carry different columns and a page is small. Pagination is by
 * timestamp: `before` is the `at` of the last item on the previous page.
 * Every source is asked for `limit` rows older than `before`, so the merged
 * page is exact — the (limit+1)-th oldest item across sources can never be
 * younger than something that was left out.
 */

export type TimelineItem =
  | {
      kind: "message";
      at: Date;
      id: string;
      direction: "INBOUND" | "OUTBOUND";
      text: string | null;
      status: string;
      error: string | null;
    }
  | {
      kind: "flow_started" | "flow_completed" | "flow_abandoned";
      at: Date;
      id: string;
      flowId: string;
      flowName: string;
    }
  | { kind: "note"; at: Date; id: string; text: string }
  | { kind: "event"; at: Date; id: string; event: ContactEventKind; payload: unknown };

export type TimelinePage = { items: TimelineItem[]; nextBefore: Date | null };

export async function contactTimeline(
  db: PrismaClient,
  contactId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<TimelinePage> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const older: Prisma.DateTimeFilter | undefined = opts.before ? { lt: opts.before } : undefined;
  const desc = "desc" as const;

  const [messages, sessions, notes, events] = await Promise.all([
    db.message.findMany({
      where: { contactId, createdAt: older },
      orderBy: { createdAt: desc },
      take: limit,
      select: { id: true, createdAt: true, direction: true, text: true, status: true, error: true },
    }),
    // A session contributes up to two items; `updatedAt` is the end for a
    // finished one. Fetching by start alone could miss a long run that
    // started before the page but ended inside it, so both bounds are used.
    db.flowSession.findMany({
      where: {
        contactId,
        ...(opts.before ? { OR: [{ startedAt: older }, { updatedAt: older }] } : {}),
      },
      orderBy: { updatedAt: desc },
      take: limit,
      select: {
        id: true,
        flowId: true,
        startedAt: true,
        updatedAt: true,
        status: true,
        flow: { select: { name: true } },
      },
    }),
    db.contactNote.findMany({
      where: { contactId, createdAt: older },
      orderBy: { createdAt: desc },
      take: limit,
      select: { id: true, createdAt: true, text: true },
    }),
    db.contactEvent.findMany({
      where: { contactId, createdAt: older },
      orderBy: { createdAt: desc },
      take: limit,
      select: { id: true, createdAt: true, kind: true, payload: true },
    }),
  ]);

  const items: TimelineItem[] = [];

  for (const m of messages) {
    items.push({
      kind: "message",
      at: m.createdAt,
      id: m.id,
      direction: m.direction,
      text: m.text,
      status: m.status,
      error: m.error,
    });
  }

  for (const s of sessions) {
    const base = { id: s.id, flowId: s.flowId, flowName: s.flow.name };
    items.push({ kind: "flow_started", at: s.startedAt, ...base });
    if (s.status === "COMPLETED") items.push({ kind: "flow_completed", at: s.updatedAt, ...base });
    if (s.status === "ABANDONED") items.push({ kind: "flow_abandoned", at: s.updatedAt, ...base });
  }

  for (const n of notes) items.push({ kind: "note", at: n.createdAt, id: n.id, text: n.text });

  for (const e of events) {
    items.push({ kind: "event", at: e.createdAt, id: e.id, event: e.kind, payload: e.payload });
  }

  const page = items
    .filter((i) => !opts.before || i.at.getTime() < opts.before.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);

  return { items: page, nextBefore: page.length === limit ? page[page.length - 1]!.at : null };
}

export async function addContactNote(db: PrismaClient, contactId: string, text: string) {
  const clean = text.trim();
  if (!clean) throw new Error("A nota não pode ficar vazia.");
  return db.contactNote.create({ data: { contactId, text: clean.slice(0, 2000) } });
}

export async function deleteContactNote(db: PrismaClient, id: string): Promise<void> {
  await db.contactNote.delete({ where: { id } });
}
