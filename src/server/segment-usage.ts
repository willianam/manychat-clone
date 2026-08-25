import type { PrismaClient } from "@prisma/client";

/**
 * Where a segment is referenced. Broadcast.segmentId is SET NULL on delete,
 * so the database would let the row go; the UI refuses instead, because a
 * broadcast that silently loses its audience is worse than a blocked delete.
 */
export async function broadcastsUsingSegment(
  db: PrismaClient,
  segmentId: string,
): Promise<Array<{ id: string; name: string; status: string }>> {
  return db.broadcast.findMany({
    where: { segmentId },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}
