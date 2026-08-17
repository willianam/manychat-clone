"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";
import { reindexGraph, starterGraph } from "../../lib/flow-edit";

/**
 * Flow CRUD.
 *
 * Every path that writes a graph — create and duplicate included — runs it
 * through `FlowGraph` and `validateGraph` first. A flow only reaches the
 * database in a state the runner can execute; there is no such thing here as
 * a flow that exists but cannot run.
 */

/** Reject a graph that would strand a live conversation. */
function assertRunnable(graph: unknown): FlowGraph {
  const parsed = FlowGraph.parse(graph);
  const errors = validateGraph(parsed).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error(`Fluxo inválido: ${errors.map((e) => e.message).join(" ")}`);
  }
  return parsed;
}

function cleanName(raw: FormDataEntryValue | null, fallback: string): string {
  const name = String(raw ?? "").trim();
  return name === "" ? fallback : name.slice(0, 120);
}

/**
 * Create a flow. It is born with a greeting wired to an end node, so it is
 * valid and runnable from the first second — a flow you have to repair before
 * you can save it is worse than no flow.
 */
export async function createFlow(formData: FormData) {
  const name = cleanName(formData.get("name"), "Fluxo sem nome");
  const graph = assertRunnable(starterGraph());

  const flow = await db.flow.create({
    data: { name, enabled: false, graph: graph as never },
  });

  revalidatePath("/flows");
  redirect(`/flows/${flow.id}`);
}

export async function renameFlow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Fluxo não informado.");

  const name = cleanName(formData.get("name"), "");
  if (!name) throw new Error("O nome não pode ficar vazio.");

  await db.flow.update({ where: { id }, data: { name } });

  revalidatePath("/flows");
  revalidatePath(`/flows/${id}`);
}

/**
 * Duplicate a flow. Ids are re-issued across the copy — they are unique only
 * within a graph, and sharing them across two flows makes metrics and
 * debugging ambiguous. Triggers are deliberately not copied: two flows
 * answering the same keyword would race each other.
 */
export async function duplicateFlow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Fluxo não informado.");

  const source = await db.flow.findUnique({ where: { id } });
  if (!source) throw new Error("Fluxo não encontrado.");

  const graph = assertRunnable(reindexGraph(FlowGraph.parse(source.graph)));

  const copy = await db.flow.create({
    data: {
      name: `${source.name} (cópia)`,
      // A copy never inherits "live" — you turn it on once you mean it.
      enabled: false,
      graph: graph as never,
    },
  });

  revalidatePath("/flows");
  redirect(`/flows/${copy.id}`);
}

export async function deleteFlow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Fluxo não informado.");

  // Triggers and sessions cascade at the schema level.
  await db.flow.delete({ where: { id } });

  revalidatePath("/flows");
}

/**
 * Turn a flow on or off. Turning it *on* re-validates: a flow saved before a
 * schema change, or edited elsewhere, must not go live broken.
 */
export async function setFlowEnabled(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Fluxo não informado.");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (enabled) {
    const flow = await db.flow.findUnique({ where: { id } });
    if (!flow) throw new Error("Fluxo não encontrado.");
    assertRunnable(flow.graph);
  }

  await db.flow.update({ where: { id }, data: { enabled } });

  revalidatePath("/flows");
  revalidatePath(`/flows/${id}`);
}
