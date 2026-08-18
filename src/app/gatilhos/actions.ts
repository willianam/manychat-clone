"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import { listMedia } from "../../server/ig-media-cache";
import type { IgMedia } from "../../lib/ig-media";
import {
  findConflict,
  normalizeDraft,
  describeTrigger,
  type TriggerKindName,
} from "../../lib/trigger-rules";

/**
 * Trigger CRUD.
 *
 * Every write goes through `normalizeDraft` (which decides what the trigger
 * is allowed to be) and `findConflict` (which decides whether it can coexist
 * with what is already there). Neither check lives in the form: a trigger
 * reachable only through a server action must be validated in the action, and
 * duplicating the rules in two places is how they drift apart.
 *
 * Failures come back as values, not exceptions. Creating a duplicate keyword
 * is an ordinary thing to do by accident and deserves a sentence explaining
 * which trigger it collided with — not an error screen.
 */

export type TriggerResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Everything the trigger UI needs about one row. */
export type TriggerView = {
  id: string;
  flowId: string;
  flowName: string;
  flowEnabled: boolean;
  kind: TriggerKindName;
  pattern: string | null;
  match: "EXACT" | "CONTAINS" | "REGEX";
  mediaId: string | null;
  enabled: boolean;
  priority: number;
  summary: string;
};

function toView(t: {
  id: string;
  flowId: string;
  kind: string;
  pattern: string | null;
  match: string;
  mediaId: string | null;
  enabled: boolean;
  priority: number;
  flow?: { name: string; enabled: boolean };
}): TriggerView {
  return {
    id: t.id,
    flowId: t.flowId,
    flowName: t.flow?.name ?? "",
    flowEnabled: t.flow?.enabled ?? false,
    kind: t.kind as TriggerKindName,
    pattern: t.pattern,
    match: t.match as TriggerView["match"],
    mediaId: t.mediaId,
    enabled: t.enabled,
    priority: t.priority,
    summary: describeTrigger(t),
  };
}

/** The triggers of one flow, for the "Quando…" card on the canvas. */
export async function triggersOfFlow(flowId: string): Promise<TriggerView[]> {
  const rows = await db.trigger.findMany({
    where: { flowId },
    include: { flow: { select: { name: true, enabled: true } } },
    orderBy: [{ priority: "desc" }, { kind: "asc" }],
  });
  return rows.map(toView);
}

/**
 * The publications to offer in the post selector.
 *
 * Served through a server action rather than fetched from the browser so the
 * IG token never leaves the server. Cached upstream — see ig-media-cache.
 */
export async function loadMedia(
  refresh = false,
): Promise<{ media: IgMedia[]; error: string | null }> {
  const result = await listMedia({ refresh });
  return { media: result.media, error: result.error };
}

export type TriggerInput = {
  flowId: string;
  kind: string;
  pattern?: string;
  match?: string;
  mediaId?: string | null;
  priority?: number;
};

export async function createTrigger(input: TriggerInput): Promise<TriggerResult> {
  const flowId = String(input.flowId ?? "").trim();
  if (!flowId) return { ok: false, error: "Fluxo não informado." };

  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) return { ok: false, error: "Fluxo não encontrado." };

  const normalized = normalizeDraft(input);
  if (!normalized.ok) return normalized;
  const draft = normalized.draft;

  // Conflicts are global, not per-flow: the dispatcher searches every enabled
  // trigger of a kind, so the same keyword on two different flows is exactly
  // the race we are preventing.
  const existing = await db.trigger.findMany({
    where: { kind: draft.kind },
    include: { flow: { select: { name: true, enabled: true } } },
  });

  const clash = findConflict(draft, existing);
  if (clash) {
    return { ok: false, error: conflictMessage(clash) };
  }

  const created = await db.trigger.create({
    data: {
      flowId,
      kind: draft.kind,
      pattern: draft.pattern,
      match: draft.match,
      mediaId: draft.mediaId,
      priority: clampPriority(input.priority),
      enabled: true,
    },
  });

  revalidateTriggerViews(flowId);
  return { ok: true, id: created.id };
}

export async function updateTrigger(
  id: string,
  input: Omit<TriggerInput, "flowId"> & { flowId?: string },
): Promise<TriggerResult> {
  const triggerId = String(id ?? "").trim();
  if (!triggerId) return { ok: false, error: "Gatilho não informado." };

  const current = await db.trigger.findUnique({ where: { id: triggerId } });
  if (!current) return { ok: false, error: "Gatilho não encontrado." };

  const flowId = String(input.flowId ?? current.flowId).trim();
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) return { ok: false, error: "Fluxo não encontrado." };

  const normalized = normalizeDraft(input);
  if (!normalized.ok) return normalized;
  const draft = normalized.draft;

  const existing = await db.trigger.findMany({
    where: { kind: draft.kind },
    include: { flow: { select: { name: true, enabled: true } } },
  });

  const clash = findConflict(draft, existing, triggerId);
  if (clash) {
    return { ok: false, error: conflictMessage(clash) };
  }

  await db.trigger.update({
    where: { id: triggerId },
    data: {
      flowId,
      kind: draft.kind,
      pattern: draft.pattern,
      match: draft.match,
      mediaId: draft.mediaId,
      priority: clampPriority(input.priority ?? current.priority),
    },
  });

  revalidateTriggerViews(flowId);
  if (flowId !== current.flowId) revalidateTriggerViews(current.flowId);
  return { ok: true, id: triggerId };
}

export async function setTriggerEnabled(
  id: string,
  enabled: boolean,
): Promise<TriggerResult> {
  const triggerId = String(id ?? "").trim();
  if (!triggerId) return { ok: false, error: "Gatilho não informado." };

  const current = await db.trigger.findUnique({ where: { id: triggerId } });
  if (!current) return { ok: false, error: "Gatilho não encontrado." };

  await db.trigger.update({ where: { id: triggerId }, data: { enabled } });

  revalidateTriggerViews(current.flowId);
  return { ok: true, id: triggerId };
}

export async function deleteTrigger(id: string): Promise<TriggerResult> {
  const triggerId = String(id ?? "").trim();
  if (!triggerId) return { ok: false, error: "Gatilho não informado." };

  const current = await db.trigger.findUnique({ where: { id: triggerId } });
  if (!current) return { ok: false, error: "Gatilho não encontrado." };

  await db.trigger.delete({ where: { id: triggerId } });

  revalidateTriggerViews(current.flowId);
  return { ok: true, id: triggerId };
}

/**
 * Explain a collision by naming the flow that already owns the rule, so the
 * owner can go turn that one off instead of guessing what "duplicado" meant.
 */
function conflictMessage(clash: {
  pattern: string | null;
  flow?: { name: string } | null;
}): string {
  const where = clash.flow?.name ? ` no fluxo "${clash.flow.name}"` : "";
  return clash.pattern
    ? `Já existe um gatilho com "${clash.pattern}"${where}.`
    : `Já existe um gatilho desse tipo${where}.`;
}

/** Priority is a tie-breaker, not a score; keep it in a sane band. */
function clampPriority(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function revalidateTriggerViews(flowId: string): void {
  revalidatePath("/gatilhos");
  revalidatePath("/flows");
  revalidatePath(`/flows/${flowId}`);
}
