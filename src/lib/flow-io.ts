import { z } from "zod";
import { FlowGraph, validateGraph } from "./flow-schema";

/**
 * Flow export / import.
 *
 * The graph is already JSON, so the file format is barely a format: a thin
 * envelope around the same document the database stores. The envelope exists
 * for two reasons — a name to restore, and a version field so a future schema
 * change can be detected rather than silently mis-parsed.
 *
 * Import is deliberately strict. A file that does not parse, or that parses
 * into a graph the runner could not execute, is rejected with a message that
 * names the actual problem. The alternative — importing a broken flow and
 * failing later against a live conversation — is the failure mode this whole
 * codebase is built to avoid.
 */

/** Bumped only on a breaking change to the graph shape. */
export const FLOW_FILE_VERSION = 1;

export const FlowFile = z.object({
  /** Marks the file as ours, so an arbitrary .json is rejected on sight. */
  kind: z.literal("manychat-clone/flow"),
  version: z.number().int().min(1),
  name: z.string().min(1).max(120),
  exportedAt: z.string().optional(),
  graph: FlowGraph,
});
export type FlowFile = z.infer<typeof FlowFile>;

export function serializeFlow(name: string, graph: FlowGraph): string {
  const file: FlowFile = {
    kind: "manychat-clone/flow",
    version: FLOW_FILE_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    graph,
  };
  return JSON.stringify(file, null, 2);
}

export type ParseResult =
  | { ok: true; file: FlowFile; warnings: string[] }
  | { ok: false; error: string };

/**
 * Parse and fully validate an exported flow file.
 *
 * Runs the same two gates every write path uses — the Zod shape, then
 * `validateGraph` — so an imported flow is runnable by the same standard as
 * one built in the editor. Structural *warnings* (a node that leads nowhere)
 * are surfaced but do not block: they are legal in the editor too.
 */
export function parseFlowFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "O arquivo não é um JSON válido." };
  }

  const parsed = FlowFile.safeParse(raw);
  if (!parsed.success) {
    // A wrong `kind` almost always means the user picked the wrong file, so
    // it is worth saying that instead of dumping a field-level Zod error.
    const isOurs =
      !!raw &&
      typeof raw === "object" &&
      (raw as { kind?: unknown }).kind === "manychat-clone/flow";
    if (!isOurs) {
      return {
        ok: false,
        error: "Este arquivo não é um fluxo exportado por aqui.",
      };
    }

    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") ?? "";
    return {
      ok: false,
      error: `O fluxo do arquivo é inválido${where ? ` em "${where}"` : ""}: ${
        issue?.message ?? "formato inesperado"
      }.`,
    };
  }

  if (parsed.data.version > FLOW_FILE_VERSION) {
    return {
      ok: false,
      error: `O arquivo foi exportado por uma versão mais nova (v${parsed.data.version}). Atualize antes de importar.`,
    };
  }

  const issues = validateGraph(parsed.data.graph);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    return {
      ok: false,
      error: `O fluxo do arquivo não pode rodar: ${errors.map((e) => e.message).join(" ")}`,
    };
  }

  return {
    ok: true,
    file: parsed.data,
    warnings: issues.filter((i) => i.level === "warning").map((i) => i.message),
  };
}

/** A safe download filename derived from the flow name. */
export function exportFilename(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `fluxo-${slug || "sem-nome"}.json`;
}
