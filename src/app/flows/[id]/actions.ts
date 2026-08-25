"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../../server/db";
import { FlowGraph, validateGraph } from "../../../lib/flow-schema";

/**
 * Draft vs published.
 *
 * The editor writes to `draftGraph`; the runner keeps reading `graph`. So
 * an edit in progress never changes what a live conversation gets until the
 * owner presses "Publicar", which copies the draft over and clears it.
 *
 * Both writes re-validate server-side: the editor blocks the button on
 * errors, but a flow that reaches the runner broken would strand a live
 * conversation, so the check can't live only in the browser.
 */
function assertRunnable(graph: unknown): FlowGraph {
  const parsed = FlowGraph.parse(graph);
  const errors = validateGraph(parsed).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`Fluxo inválido: ${errors.map((e) => e.message).join(" ")}`);
  }
  return parsed;
}

/** Save the editor's graph as the draft. */
export async function saveFlow(flowId: string, graph: unknown) {
  const parsed = assertRunnable(graph);

  await db.flow.update({
    where: { id: flowId },
    data: { draftGraph: parsed as never },
  });

  revalidatePath(`/flows/${flowId}`);
  revalidatePath("/flows");
}

/** Promote the draft to the graph the runner reads. No draft = nothing to do. */
export async function publishFlow(flowId: string) {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) throw new Error("Fluxo não encontrado.");
  if (flow.draftGraph === null) return;

  const parsed = assertRunnable(flow.draftGraph);

  await db.flow.update({
    where: { id: flowId },
    data: { graph: parsed as never, draftGraph: null as never, publishedAt: new Date() },
  });

  revalidatePath(`/flows/${flowId}`);
  revalidatePath("/flows");
}

/** Throw the draft away; the editor goes back to the published graph. */
export async function discardDraft(flowId: string) {
  await db.flow.update({
    where: { id: flowId },
    data: { draftGraph: null as never },
  });

  revalidatePath(`/flows/${flowId}`);
  revalidatePath("/flows");
}
