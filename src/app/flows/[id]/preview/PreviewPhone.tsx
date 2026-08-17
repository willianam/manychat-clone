"use client";

import { useMemo, useState } from "react";
import type { FlowGraph } from "../../../../lib/flow-schema";
import { previewFrom, type PreviewChoice, type PreviewItem } from "../../../../lib/flow-preview";

/**
 * The flow, rendered as the DM it produces.
 *
 * Read-only by construction: this component imports nothing from `server/`,
 * so there is no path from here to the Instagram API. Reviewing copy must
 * never risk a real send.
 *
 * Branches are driven by the reviewer. Tapping a button walks that path and
 * appends to the transcript; "Recomeçar" clears the picks. Because every pick
 * is keyed by node id, re-picking a choice higher up truncates everything
 * below it automatically — the transcript is derived from the picks, never
 * accumulated.
 */
export function PreviewPhone({ graph, name }: { graph: FlowGraph; name: string }) {
  const [choices, setChoices] = useState<Record<string, string>>({});

  const items = useMemo(() => previewFrom(graph, choices), [graph, choices]);

  const pick = (nodeId: string, handle: string) =>
    setChoices((c) => ({ ...c, [nodeId]: handle }));

  const reset = () => setChoices({});

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-[360px] overflow-hidden rounded-[28px] border-[6px] border-neutral-800 bg-white shadow-xl dark:bg-neutral-950">
        {/* Header, mimicking the DM thread so the copy is read in context. */}
        <div className="flex items-center gap-2 border-b bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold">{name}</div>
            <div className="text-[9px] text-neutral-400">pré-visualização · nada é enviado</div>
          </div>
        </div>

        <div className="h-[560px] space-y-2 overflow-y-auto bg-white p-3 dark:bg-neutral-950">
          {items.map((item, i) => (
            <Item key={`${item.nodeId}-${i}`} item={item} onPick={pick} />
          ))}
        </div>
      </div>

      <button
        onClick={reset}
        disabled={Object.keys(choices).length === 0}
        className="rounded-lg border px-3 py-1 text-xs font-medium transition hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        Recomeçar
      </button>
    </div>
  );
}

function Item({
  item,
  onPick,
}: {
  item: PreviewItem;
  onPick: (nodeId: string, handle: string) => void;
}) {
  switch (item.kind) {
    case "bubble":
      return (
        <div>
          <Bubble text={item.text} />
          {item.buttons.length > 0 && (
            <Choices nodeId={item.nodeId} choices={item.buttons} onPick={onPick} shape="block" />
          )}
        </div>
      );

    case "quickreply":
      return (
        <div>
          <Bubble text={item.text} />
          <Choices nodeId={item.nodeId} choices={item.options} onPick={onPick} shape="pill" />
        </div>
      );

    case "carousel":
      return (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {item.cards.map((c, i) => (
            <div
              key={i}
              className="w-[168px] shrink-0 overflow-hidden rounded-xl border dark:border-neutral-700"
            >
              <div
                className="h-[92px] bg-neutral-100 dark:bg-neutral-800"
                style={
                  c.imageUrl
                    ? { backgroundImage: `url(${c.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined
                }
              />
              <div className="px-2 py-1.5">
                <div className="truncate text-[12px] font-semibold">{c.title}</div>
                {c.subtitle && (
                  <div className="truncate text-[10px] text-neutral-500">{c.subtitle}</div>
                )}
              </div>
              {c.buttons.map((b) => (
                <ChoiceButton
                  key={b.handle}
                  choice={b}
                  onClick={() => onPick(item.nodeId, b.handle)}
                  shape="block"
                />
              ))}
            </div>
          ))}
        </div>
      );

    case "media":
      return <Media item={item} />;

    case "input":
      return (
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-dashed border-neutral-300 px-3 py-1.5 text-[12px] text-neutral-400 dark:border-neutral-600">
            resposta do contato → <span className="font-mono">{item.saveAs}</span>
          </div>
        </div>
      );

    case "note":
      return (
        <div className="my-1 text-center text-[10px] uppercase tracking-wide text-neutral-400">
          — {item.text} —
        </div>
      );

    case "fork":
      return (
        <div className="rounded-lg border border-dashed p-2 dark:border-neutral-700">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-teal-600">
            {item.label}
          </div>
          <Choices nodeId={item.nodeId} choices={item.choices} onPick={onPick} shape="pill" />
        </div>
      );

    case "end":
      return (
        <div className="my-2 text-center text-[10px] uppercase tracking-wide text-neutral-400">
          — fim da conversa —
        </div>
      );

    case "dangling":
      return (
        <div className="my-2 rounded-lg bg-amber-50 px-2 py-1.5 text-center text-[10px] text-amber-700 dark:bg-amber-950/40">
          O fluxo para aqui: este bloco não leva a lugar nenhum.
        </div>
      );
  }
}

function Bubble({ text }: { text: string }) {
  return (
    <div className="flex">
      <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2 text-[13px] leading-snug dark:bg-neutral-800">
        {text}
      </div>
    </div>
  );
}

function Media({ item }: { item: Extract<PreviewItem, { kind: "media" }> }) {
  // Images we can actually render; video, audio and PDF we cannot, so they
  // get a labelled placeholder rather than a broken element.
  const isImage = item.media === "image" || item.media === "album";

  if (isImage) {
    return (
      <div className={`grid gap-1 ${item.urls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {item.urls.map((u, i) => (
          <div
            key={i}
            className="h-[110px] rounded-xl bg-neutral-100 dark:bg-neutral-800"
            style={{ backgroundImage: `url(${u})`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        ))}
      </div>
    );
  }

  const icon = item.media === "video" ? "▶" : item.media === "audio" ? "♪" : "▤";
  return (
    <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800">
      <span className="text-[18px]">{icon}</span>
      <span className="truncate text-[12px] text-neutral-600 dark:text-neutral-300">
        {item.label}
      </span>
    </div>
  );
}

function Choices({
  nodeId,
  choices,
  onPick,
  shape,
}: {
  nodeId: string;
  choices: PreviewChoice[];
  onPick: (nodeId: string, handle: string) => void;
  shape: "pill" | "block";
}) {
  return (
    <div className={shape === "pill" ? "mt-1.5 flex flex-wrap gap-1" : "mt-1.5 space-y-1"}>
      {choices.map((c) => (
        <ChoiceButton
          key={c.handle}
          choice={c}
          onClick={() => onPick(nodeId, c.handle)}
          shape={shape}
        />
      ))}
    </div>
  );
}

function ChoiceButton({
  choice,
  onClick,
  shape,
}: {
  choice: PreviewChoice;
  onClick: () => void;
  shape: "pill" | "block";
}) {
  // A url button leaves the flow, and an unwired one has nowhere to go: both
  // are shown but not clickable, so a dead branch is visible as a dead branch.
  const inert = choice.external || choice.target === null;

  const base =
    shape === "pill"
      ? "rounded-full border px-3 py-1 text-[12px] font-semibold"
      : "block w-full border-t px-3 py-1.5 text-center text-[12px] font-semibold dark:border-neutral-700";

  return (
    <button
      onClick={onClick}
      disabled={inert}
      title={
        choice.external
          ? "Abre um link — sai do fluxo"
          : choice.target === null
            ? "Esta saída não está ligada a nada"
            : undefined
      }
      className={`${base} transition ${
        inert
          ? "cursor-not-allowed border-neutral-200 text-neutral-400 dark:border-neutral-700"
          : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-950/40"
      }`}
    >
      {choice.label}
      {choice.external && " ↗"}
      {!choice.external && choice.target === null && " ⚠"}
    </button>
  );
}
