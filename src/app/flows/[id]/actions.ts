"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../../server/db";
import { FlowGraph, validateGraph } from "../../../lib/flow-schema";

/**
 * Persist a flow graph.
 *
 * Re-validates server-side: the editor blocks the button on errors, but a
 * flow that reaches the runner broken would strand a live conversation, so
 * the check can't live only in the browser.
 */
export async function saveFlow(flowId: string, graph: unknown) {
  const parsed = FlowGraph.parse(graph);

  const errors = validateGraph(parsed).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`Fluxo inválido: ${errors.map((e) => e.message).join(" ")}`);
  }

  await db.flow.update({
    where: { id: flowId },
    data: { graph: parsed as never },
  });

  revalidatePath(`/flows/${flowId}`);
}
