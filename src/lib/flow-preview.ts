import { FlowGraph, findEntryNode, armLabel, type FlowNodeData } from "./flow-schema";

/**
 * Flow preview: the graph rendered as the conversation it produces.
 *
 * The point is reviewing copy. Reading a flow on the canvas tells you the
 * structure; it does not tell you whether the third message repeats the
 * second, or whether the whole sequence reads like a person. The only way to
 * see that today is to DM the account for real, which means a live send, a
 * burned test contact, and a 24-hour window to wait out.
 *
 * This walks the same graph the runner walks, with the same `nextOf` edge
 * rule, and emits what a phone would show. It is pure and read-only: no API
 * call, no database, no session. Every branch point is a *choice* the reviewer
 * makes, not a random pick — so you can drive the conversation down each path
 * deliberately and read all of them.
 *
 * Where it deliberately differs from the runner:
 *   - condition and random do not evaluate; they are presented as a fork the
 *     reviewer picks, because there is no contact to evaluate against.
 *   - delay is shown as a marker rather than waited on.
 *   - {{variables}} are left visible, since their values are what the
 *     reviewer is checking the copy around.
 */

const MAX_STEPS = 50; // same cycle guard as the runner

/** One thing the phone shows, in order. */
export type PreviewItem =
  | { kind: "bubble"; nodeId: string; text: string; buttons: PreviewChoice[] }
  | { kind: "quickreply"; nodeId: string; text: string; options: PreviewChoice[] }
  | { kind: "carousel"; nodeId: string; cards: PreviewCard[] }
  | {
      kind: "media";
      nodeId: string;
      media: "image" | "video" | "audio" | "file" | "album";
      urls: string[];
      label: string;
    }
  | { kind: "input"; nodeId: string; saveAs: string }
  | { kind: "note"; nodeId: string; text: string }
  | { kind: "fork"; nodeId: string; label: string; choices: PreviewChoice[] }
  | { kind: "end"; nodeId: string }
  | { kind: "dangling"; nodeId: string };

export type PreviewChoice = {
  /** The edge sourceHandle this choice follows. */
  handle: string;
  label: string;
  /** Absent when the choice is not wired to anything. */
  target: string | null;
  /** A url button leaves the flow rather than continuing it. */
  external?: boolean;
};

export type PreviewCard = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons: PreviewChoice[];
};

/**
 * Walk from `startId` (or the entry node) until the conversation blocks on a
 * choice, ends, or dead-ends.
 *
 * `choices` maps a node id to the handle the reviewer picked there, letting
 * the caller replay a path deterministically.
 */
export function previewFrom(
  graph: FlowGraph,
  choices: Record<string, string> = {},
  startId?: string,
): PreviewItem[] {
  const items: PreviewItem[] = [];
  let current: string | null = startId ?? findEntryNode(graph);

  for (let step = 0; step < MAX_STEPS && current; step++) {
    const node = graph.nodes.find((n) => n.id === current);
    if (!node) break;

    const d: FlowNodeData = node.data;
    const id: string = node.id;
    const picked: string | undefined = choices[id];

    if (d.kind === "end") {
      items.push({ kind: "end", nodeId: id });
      break;
    }

    if (d.kind === "message") {
      const buttons = (d.buttons ?? []).map<PreviewChoice>((b) =>
        b.type === "url"
          ? { handle: b.id, label: b.title, target: null, external: true }
          : { handle: b.id, label: b.title, target: targetOf(graph, id, b.id) },
      );
      items.push({ kind: "bubble", nodeId: id, text: d.text, buttons });

      // Postback buttons block, exactly as in the runner.
      if (buttons.some((b) => !b.external)) {
        current = followChoice(buttons, picked);
        if (current === null) break;
        continue;
      }
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "quickreply") {
      const options = d.options.map<PreviewChoice>((o) => ({
        handle: o.id,
        label: o.title,
        target: targetOf(graph, id, o.id),
      }));
      items.push({ kind: "quickreply", nodeId: id, text: d.text, options });
      current = followChoice(options, picked);
      if (current === null) break;
      continue;
    }

    if (d.kind === "question") {
      items.push({ kind: "bubble", nodeId: id, text: d.text, buttons: [] });
      items.push({ kind: "input", nodeId: id, saveAs: d.saveAs });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "carousel") {
      const cards = d.cards.map<PreviewCard>((c) => ({
        title: c.title,
        subtitle: c.subtitle,
        imageUrl: c.imageUrl,
        buttons: (c.buttons ?? []).map<PreviewChoice>((b) =>
          b.type === "url"
            ? { handle: b.id, label: b.title, target: null, external: true }
            : { handle: b.id, label: b.title, target: targetOf(graph, id, b.id) },
        ),
      }));
      items.push({ kind: "carousel", nodeId: id, cards });

      const all = cards.flatMap((c) => c.buttons);
      if (all.some((b) => !b.external)) {
        current = followChoice(all, picked);
        if (current === null) break;
        continue;
      }
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "image" || d.kind === "video" || d.kind === "audio" || d.kind === "file") {
      items.push({
        kind: "media",
        nodeId: id,
        media: d.kind,
        urls: d.url ? [d.url] : [],
        label:
          d.kind === "image"
            ? (d.caption ?? "Imagem")
            : d.kind === "file"
              ? (d.filename ?? "Documento PDF")
              : d.kind === "video"
                ? "Vídeo"
                : "Áudio",
      });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "album") {
      items.push({
        kind: "media",
        nodeId: id,
        media: "album",
        urls: d.urls,
        label: `${d.urls.length} ${d.urls.length === 1 ? "imagem" : "imagens"}`,
      });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "condition") {
      const choicesHere: PreviewChoice[] = [
        { handle: "true", label: "sim", target: targetOf(graph, id, "true") },
        { handle: "false", label: "não", target: targetOf(graph, id, "false") },
      ];
      items.push({
        kind: "fork",
        nodeId: id,
        label: `Se ${d.key} ${d.op}${d.value ? ` ${d.value}` : ""}`,
        choices: choicesHere,
      });
      current = followChoice(choicesHere, picked);
      if (current === null) break;
      continue;
    }

    if (d.kind === "random") {
      const choicesHere = d.weights.map<PreviewChoice>((w, i) => ({
        handle: String(i),
        label: `${armLabel(d, i)} · ${w}%`,
        target: targetOf(graph, id, String(i)),
      }));
      items.push({ kind: "fork", nodeId: id, label: "Randomizador", choices: choicesHere });
      current = followChoice(choicesHere, picked);
      if (current === null) break;
      continue;
    }

    // Silent nodes: shown as a margin note so the reviewer knows time passes
    // or state changes here, without it looking like a message.
    if (d.kind === "delay") {
      const text =
        d.mode === "untilReply"
          ? `Espera a resposta${d.timeoutSeconds ? ` (até ${humanize(d.timeoutSeconds)})` : ""}`
          : d.mode === "untilDate"
            ? `Espera até ${d.untilDate?.replace("T", " ")}`
            : `Espera ${humanize(d.seconds ?? 0)}`;
      items.push({ kind: "note", nodeId: id, text });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "action") {
      items.push({ kind: "note", nodeId: id, text: describeOps(d.ops) });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "goal") {
      items.push({ kind: "note", nodeId: id, text: `Meta "${d.name}" atingida` });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "goto") {
      if ("flowId" in d.target) {
        items.push({ kind: "note", nodeId: id, text: `Vai para outro fluxo (${d.target.flowId})` });
        break;
      }
      items.push({ kind: "note", nodeId: id, text: `Volta para o passo "${d.target.nodeId}"` });
      const to = d.target.nodeId;
      current = graph.nodes.some((n) => n.id === to) ? to : null;
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    if (d.kind === "tag") {
      items.push({
        kind: "note",
        nodeId: id,
        text: `${d.action === "add" ? "Marca" : "Remove"} a tag "${d.tagName}"`,
      });
      current = targetOf(graph, id);
      if (!current) {
        items.push({ kind: "dangling", nodeId: id });
        break;
      }
      continue;
    }

    break;
  }

  return items;
}

/**
 * Resolve a picked choice to the next node.
 *
 * Returns `null` to mean "stop here" — either nothing was picked yet (the
 * conversation is waiting on the reviewer) or the picked branch is unwired.
 */
function followChoice(choices: PreviewChoice[], picked: string | undefined): string | null {
  if (picked === undefined) return null;
  return choices.find((c) => c.handle === picked)?.target ?? null;
}

/** Same edge rule the runner uses. */
function targetOf(graph: FlowGraph, from: string, handle?: string): string | null {
  const edge = graph.edges.find(
    (e) => e.source === from && (handle === undefined || e.sourceHandle === handle),
  );
  return edge?.target ?? null;
}

function describeOps(ops: Extract<FlowNodeData, { kind: "action" }>["ops"]): string {
  return ops
    .map((o) => {
      if (o.op === "addTag") return `+ tag ${o.tagName}`;
      if (o.op === "removeTag") return `− tag ${o.tagName}`;
      if (o.op === "setField") return `${o.key} = ${o.value}`;
      if (o.op === "unsetField") return `limpa ${o.key}`;
      return o.op === "unsubscribe" ? "cancela inscrição" : "reativa inscrição";
    })
    .join(" · ");
}

function humanize(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)} dias`;
}
