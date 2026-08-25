"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";
import { reindexGraph, starterGraph } from "../../lib/flow-edit";
import { parseFlowFile } from "../../lib/flow-io";
import { findConflict, normalizeDraft } from "../../lib/trigger-rules";

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
 * Creating a flow now goes through `createFlowWithObjective` (below), which
 * asks what should START the flow and writes the Trigger in the same
 * transaction. The old name-only `createFlow` was removed rather than kept
 * around: it was the path that produced flows nothing could ever fire.
 */

/**
 * Import a flow from an exported JSON file.
 *
 * Ids are re-issued exactly as in `duplicateFlow`: the file may well have come
 * from this same database, and two flows sharing node ids make metrics and
 * debugging ambiguous. Like a duplicate, an import never arrives enabled —
 * you turn it on once you have looked at it.
 *
 * Returns the failure as a value instead of throwing, so the client can show a
 * specific message ("não é um JSON válido", "falta o nó de entrada") rather
 * than a generic server-error screen.
 */
export async function importFlow(
  text: string,
  nameOverride?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = parseFlowFile(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const name = cleanName(nameOverride ?? null, parsed.file.name);

  let graph;
  try {
    graph = assertRunnable(reindexGraph(parsed.file.graph));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const flow = await db.flow.create({
    data: { name, enabled: false, graph: graph as never },
  });

  revalidatePath("/flows");
  return { ok: true, id: flow.id };
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

/**
 * Create a flow starting from an OBJECTIVE, the way ManyChat opens.
 *
 * The first question a real automation answers is "what makes this run", not
 * "what is it called" — a flow with no trigger is inert no matter how good
 * the messages are. So the objective picker creates the Trigger in the same
 * step as the Flow, and the two are written in one transaction: a flow that
 * exists without the trigger the owner asked for is exactly the half-built
 * state this feature is meant to remove.
 *
 * "do zero" is a real objective, not an escape hatch — sometimes you are
 * building a branch that a menu or a ref link will call into. It creates the
 * flow with no trigger and says so on the canvas via the "Quando…" card.
 */
export type Objective = "comment" | "story_reply" | "keyword" | "blank";

const OBJECTIVE_KIND: Record<Exclude<Objective, "blank">, string> = {
  comment: "COMMENT",
  story_reply: "STORY_REPLY",
  keyword: "KEYWORD",
};

/** Default name when the owner did not type one, so the list stays readable. */
const OBJECTIVE_NAME: Record<Objective, string> = {
  comment: "Comentário → direct",
  story_reply: "Resposta ao story",
  keyword: "Palavra-chave",
  blank: "Fluxo sem nome",
};

export async function createFlowWithObjective(input: {
  objective: Objective;
  name?: string;
  pattern?: string;
  mediaId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const objective = input.objective;
  if (!(objective in OBJECTIVE_NAME)) {
    return { ok: false, error: "Objetivo inválido." };
  }

  const name = cleanName(input.name ?? null, OBJECTIVE_NAME[objective]);
  const graph = assertRunnable(starterGraph());

  if (objective === "blank") {
    const flow = await db.flow.create({
      data: { name, enabled: false, graph: graph as never },
    });
    revalidatePath("/flows");
    return { ok: true, id: flow.id };
  }

  // Validate the trigger BEFORE creating anything. Discovering the keyword is
  // taken only after the flow exists would leave an orphan the owner has to
  // clean up by hand.
  const normalized = normalizeDraft({
    kind: OBJECTIVE_KIND[objective],
    pattern: input.pattern,
    match: "CONTAINS",
    mediaId: input.mediaId,
  });
  if (!normalized.ok) return normalized;
  const draft = normalized.draft;

  const existing = await db.trigger.findMany({
    where: { kind: draft.kind },
    include: { flow: { select: { name: true } } },
  });
  const clash = findConflict(draft, existing);
  if (clash) {
    const where = clash.flow?.name ? ` no fluxo "${clash.flow.name}"` : "";
    return {
      ok: false,
      error: clash.pattern
        ? `Já existe um gatilho com "${clash.pattern}"${where}.`
        : `Já existe um gatilho desse tipo${where}.`,
    };
  }

  // One transaction: the flow and the thing that starts it arrive together.
  const flow = await db.$transaction(async (tx) => {
    const created = await tx.flow.create({
      data: { name, enabled: false, graph: graph as never },
    });
    await tx.trigger.create({
      data: {
        flowId: created.id,
        kind: draft.kind,
        pattern: draft.pattern,
        match: draft.match,
        mediaId: draft.mediaId,
        // A post-specific comment trigger should beat the catch-all even if
        // the catch-all was created later; priority makes that explicit
        // rather than relying on the dispatcher's mediaId ordering alone.
        priority: draft.mediaId ? 10 : 0,
        enabled: true,
      },
    });
    return created;
  });

  revalidatePath("/flows");
  revalidatePath("/gatilhos");
  return { ok: true, id: flow.id };
}
