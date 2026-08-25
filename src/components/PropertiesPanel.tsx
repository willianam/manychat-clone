"use client";

import { useState } from "react";
import type { Node } from "reactflow";
import {
  ConditionOp,
  LIMITS,
  MEDIA_FORMATS,
  type FlowButton,
  type FlowNodeData,
} from "../lib/flow-schema";
import { newButton, retypeButton, uid } from "../lib/flow-edit";

/**
 * Properties panel.
 *
 * The canvas handles the one thing you edit constantly — the message text,
 * by double-clicking it in place. Everything structural lives here: the
 * things that add or remove an output, which is to say the things that can
 * break an edge.
 *
 * Limits are enforced at the input, never at save time. A disabled "add"
 * button with the reason next to it teaches the Instagram cap; a save that
 * fails after the fact just wastes the work.
 */

type Update = (data: FlowNodeData) => void;

export function PropertiesPanel({
  node,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
}: {
  node: Node | null;
  onChange: Update;
  onDelete: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}) {
  if (!node) return null;
  const data = node.data as FlowNodeData;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{titleOf(data)}</h2>
          <p className="truncate font-mono text-[10px] text-neutral-400">{node.id}</p>
        </div>
        {onDuplicate && (
          <button
            onClick={onDuplicate}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Duplicar bloco
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Fechar painel"
          className="ml-auto rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 p-4">
        <Body data={data} onChange={onChange} />
      </div>

      <div className="border-t p-4">
        <button
          onClick={onDelete}
          className="w-full rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
        >
          Excluir este bloco
        </button>
        <p className="mt-1.5 text-center text-[10px] text-neutral-400">
          As ligações deste bloco também são removidas.
        </p>
      </div>
    </aside>
  );
}

function Body({ data, onChange }: { data: FlowNodeData; onChange: Update }) {
  switch (data.kind) {
    case "message":
      return <MessageProps data={data} onChange={onChange} />;
    case "question":
      return <QuestionProps data={data} onChange={onChange} />;
    case "quickreply":
      return <QuickReplyProps data={data} onChange={onChange} />;
    case "carousel":
      return <CarouselProps data={data} onChange={onChange} />;
    case "image":
      return <ImageProps data={data} onChange={onChange} />;
    case "video":
    case "audio":
    case "file":
      return <MediaProps data={data} onChange={onChange} />;
    case "album":
      return <AlbumProps data={data} onChange={onChange} />;
    case "condition":
      return <ConditionProps data={data} onChange={onChange} />;
    case "delay":
      return <DelayProps data={data} onChange={onChange} />;
    case "action":
      return <ActionProps data={data} onChange={onChange} />;
    case "random":
      return <RandomProps data={data} onChange={onChange} />;
    case "tag":
      return <TagProps data={data} onChange={onChange} />;
    case "end":
      return (
        <p className="text-xs text-neutral-500">
          Encerra a conversa. Não tem nada para configurar.
        </p>
      );
  }
}

/* ── shared controls ─────────────────────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-neutral-400">{hint}</span>}
    </label>
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-400";

function TextInput({
  value,
  onChange,
  max,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <>
      <input
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} ${mono ? "font-mono" : ""}`}
      />
      {max !== undefined && (
        <Counter len={value.length} max={max} />
      )}
    </>
  );
}

function TextArea({
  value,
  onChange,
  max,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  max: number;
  rows?: number;
}) {
  return (
    <>
      <textarea
        value={value}
        rows={rows}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} resize-y leading-snug`}
      />
      <Counter len={value.length} max={max} />
    </>
  );
}

/** Character budget. Turns amber near the cap so it is noticed before it bites. */
function Counter({ len, max }: { len: number; max: number }) {
  const tight = len > max * 0.9;
  return (
    <span
      className={`mt-0.5 block text-right text-[10px] tabular-nums ${
        tight ? "text-amber-600" : "text-neutral-400"
      }`}
    >
      {len}/{max}
    </span>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={INPUT}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "Adicionar" affordance that explains itself when the cap is reached. */
function AddButton({
  onClick,
  disabled,
  label,
  atLimit,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  atLimit?: string;
}) {
  return (
    <div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-lg border border-dashed px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + {label}
      </button>
      {disabled && atLimit && (
        <p className="mt-1 text-center text-[10px] text-amber-600">{atLimit}</p>
      )}
    </div>
  );
}

/** Row of reorder / delete controls used by every repeatable list. */
function RowTools({
  onUp,
  onDown,
  onRemove,
  canUp,
  canDown,
  canRemove,
  removeHint,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  canUp: boolean;
  canDown: boolean;
  canRemove: boolean;
  removeHint?: string;
}) {
  const btn =
    "rounded px-1.5 py-0.5 text-[11px] text-neutral-400 transition hover:bg-neutral-100 disabled:opacity-25";
  return (
    <div className="ml-auto flex items-center">
      <button onClick={onUp} disabled={!canUp} className={btn} aria-label="Mover para cima">
        ↑
      </button>
      <button onClick={onDown} disabled={!canDown} className={btn} aria-label="Mover para baixo">
        ↓
      </button>
      <button
        onClick={onRemove}
        disabled={!canRemove}
        title={!canRemove ? removeHint : undefined}
        className={`${btn} hover:text-rose-600`}
        aria-label="Remover"
      >
        ✕
      </button>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Button list editor, shared by message and carousel cards.
 *
 * Every edit path here mutates the button in place — `{...b, title}` — so
 * the id survives and the edge leaving this button stays attached. The only
 * place a new id is minted is `newButton`.
 */
function ButtonList({
  buttons,
  max,
  onChange,
}: {
  buttons: FlowButton[];
  max: number;
  onChange: (buttons: FlowButton[]) => void;
}) {
  const set = (i: number, b: FlowButton) => onChange(buttons.map((x, n) => (n === i ? b : x)));

  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div
          key={b.id}
          className="rounded-lg border p-2"
        >
          <div className="mb-1.5 flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Botão {i + 1}
            </span>
            <RowTools
              canUp={i > 0}
              canDown={i < buttons.length - 1}
              canRemove
              onUp={() => onChange(move(buttons, i, i - 1))}
              onDown={() => onChange(move(buttons, i, i + 1))}
              onRemove={() => onChange(buttons.filter((_, n) => n !== i))}
            />
          </div>

          <TextInput
            value={b.title}
            max={20}
            placeholder="Texto do botão"
            onChange={(title) => set(i, { ...b, title })}
          />

          <div className="mt-1.5">
            <Select
              value={b.type}
              onChange={(type) => set(i, retypeButton(b, type))}
              options={[
                { value: "postback", label: "Continua o fluxo" },
                { value: "url", label: "Abre um link" },
              ]}
            />
          </div>

          {b.type === "url" && (
            <div className="mt-1.5">
              <TextInput
                value={b.url}
                placeholder="https://…"
                onChange={(url) => set(i, { ...b, url })}
              />
            </div>
          )}
        </div>
      ))}

      <AddButton
        label="Adicionar botão"
        onClick={() => onChange([...buttons, newButton()])}
        disabled={buttons.length >= max}
        atLimit={`O Instagram aceita no máximo ${max} botões.`}
      />
    </div>
  );
}

/* ── per-kind editors ────────────────────────────────────────────── */

function MessageProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "message" }>;
  onChange: Update;
}) {
  const buttons = data.buttons ?? [];
  // With buttons the message ships as a button template, capped at 640.
  const max = buttons.length ? LIMITS.buttonTemplateText : LIMITS.messageText;

  return (
    <>
      <Field
        label="Texto"
        hint={
          buttons.length
            ? `Com botões, o Instagram corta em ${LIMITS.buttonTemplateText} caracteres.`
            : undefined
        }
      >
        <TextArea value={data.text} max={max} onChange={(text) => onChange({ ...data, text })} />
      </Field>

      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Botões
        </span>
        <p className="mb-2 mt-0.5 text-[10px] text-neutral-400">
          Cada botão &quot;continua o fluxo&quot; vira uma saída ligável no canvas.
        </p>
        <ButtonList
          buttons={buttons}
          max={LIMITS.buttons}
          onChange={(next) => onChange({ ...data, buttons: next.length ? next : undefined })}
        />
      </div>
    </>
  );
}

function QuestionProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "question" }>;
  onChange: Update;
}) {
  return (
    <>
      <Field label="Pergunta">
        <TextArea
          value={data.text}
          max={LIMITS.messageText}
          onChange={(text) => onChange({ ...data, text })}
        />
      </Field>
      <Field label="Salvar resposta em" hint="Letras, números e _; começa com letra.">
        <TextInput
          mono
          value={data.saveAs}
          placeholder="nome"
          onChange={(saveAs) => onChange({ ...data, saveAs })}
        />
      </Field>
    </>
  );
}

function QuickReplyProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "quickreply" }>;
  onChange: Update;
}) {
  const opts = data.options;
  const set = (next: typeof opts) => onChange({ ...data, options: next });

  return (
    <>
      <Field label="Texto">
        <TextArea
          value={data.text}
          max={LIMITS.messageText}
          rows={3}
          onChange={(text) => onChange({ ...data, text })}
        />
      </Field>

      <Field label="Salvar escolha em">
        <TextInput
          mono
          value={data.saveAs}
          placeholder="escolha"
          onChange={(saveAs) => onChange({ ...data, saveAs })}
        />
      </Field>

      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Opções ({opts.length}/{LIMITS.quickReplies})
        </span>
        <p className="mb-2 mt-0.5 text-[10px] text-neutral-400">
          Cada opção é uma saída do bloco. Máx. {LIMITS.quickReplyTitle} caracteres no título.
        </p>

        <div className="space-y-2">
          {opts.map((o, i) => (
            <div key={o.id} className="rounded-lg border p-2">
              <div className="mb-1 flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Opção {i + 1}
                </span>
                <RowTools
                  canUp={i > 0}
                  canDown={i < opts.length - 1}
                  // The schema requires at least one option.
                  canRemove={opts.length > 1}
                  removeHint="É preciso ao menos uma opção."
                  onUp={() => set(move(opts, i, i - 1))}
                  onDown={() => set(move(opts, i, i + 1))}
                  onRemove={() => set(opts.filter((_, n) => n !== i))}
                />
              </div>
              <TextInput
                value={o.title}
                max={LIMITS.quickReplyTitle}
                placeholder="Título"
                onChange={(title) => set(opts.map((x, n) => (n === i ? { ...x, title } : x)))}
              />
              <div className="mt-1.5">
                <TextInput
                  mono
                  value={o.value ?? ""}
                  placeholder="valor salvo (padrão: o título)"
                  onChange={(v) =>
                    set(opts.map((x, n) => (n === i ? { ...x, value: v === "" ? undefined : v } : x)))
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2">
          <AddButton
            label="Adicionar opção"
            onClick={() => set([...opts, { id: uid("o"), title: `Opção ${opts.length + 1}` }])}
            disabled={opts.length >= LIMITS.quickReplies}
            atLimit={`O Instagram aceita no máximo ${LIMITS.quickReplies} respostas rápidas.`}
          />
        </div>
      </div>
    </>
  );
}

function CarouselProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "carousel" }>;
  onChange: Update;
}) {
  const cards = data.cards;
  const set = (next: typeof cards) => onChange({ ...data, cards: next });
  const patch = (i: number, p: Partial<(typeof cards)[number]>) =>
    set(cards.map((c, n) => (n === i ? { ...c, ...p } : c)));

  return (
    <>
      <p className="text-[11px] text-neutral-500">
        Cards aparecem lado a lado. Máx. {LIMITS.carouselCards} cards e{" "}
        {LIMITS.carouselButtons} botões por card.
      </p>

      <div className="space-y-3">
        {cards.map((c, i) => (
          <div key={c.id} className="rounded-lg border p-2.5">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                Card {i + 1}
              </span>
              <RowTools
                canUp={i > 0}
                canDown={i < cards.length - 1}
                canRemove={cards.length > 1}
                removeHint="É preciso ao menos um card."
                onUp={() => set(move(cards, i, i - 1))}
                onDown={() => set(move(cards, i, i + 1))}
                onRemove={() => set(cards.filter((_, n) => n !== i))}
              />
            </div>

            <Field label="Título">
              <TextInput value={c.title} max={80} onChange={(title) => patch(i, { title })} />
            </Field>

            <div className="mt-2">
              <Field label="Subtítulo">
                <TextInput
                  value={c.subtitle ?? ""}
                  max={80}
                  onChange={(v) => patch(i, { subtitle: v === "" ? undefined : v })}
                />
              </Field>
            </div>

            <div className="mt-2">
              <Field label="Imagem (URL)">
                <TextInput
                  value={c.imageUrl ?? ""}
                  placeholder="https://…"
                  onChange={(v) => patch(i, { imageUrl: v === "" ? undefined : v })}
                />
              </Field>
            </div>

            <div className="mt-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Botões do card
              </span>
              <div className="mt-1.5">
                <ButtonList
                  buttons={c.buttons ?? []}
                  max={LIMITS.carouselButtons}
                  onChange={(next) => patch(i, { buttons: next.length ? next : undefined })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <AddButton
        label="Adicionar card"
        onClick={() =>
          set([
            ...cards,
            {
              id: uid("c"),
              title: `Card ${cards.length + 1}`,
              buttons: [newButton("Quero")],
            },
          ])
        }
        disabled={cards.length >= LIMITS.carouselCards}
        atLimit={`O Instagram aceita no máximo ${LIMITS.carouselCards} cards.`}
      />
    </>
  );
}

function ImageProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "image" }>;
  onChange: Update;
}) {
  return (
    <>
      <Field label="URL da imagem" hint="Precisa ser um endereço público (https).">
        <TextInput
          value={data.url ?? ""}
          placeholder="https://…"
          onChange={(url) => onChange({ ...data, url: url || undefined })}
        />
      </Field>
      <Field label="Legenda">
        <TextArea
          value={data.caption ?? ""}
          max={LIMITS.messageText}
          rows={3}
          onChange={(v) => onChange({ ...data, caption: v === "" ? undefined : v })}
        />
      </Field>
    </>
  );
}

/**
 * Video, audio and PDF.
 *
 * The size ceiling is stated but not enforced: the file lives at a URL we do
 * not fetch, so the editor genuinely cannot know how big it is. Saying "máx.
 * 25 MB" next to the field is the honest version — a validation that always
 * passes would be worse than none, because it would imply a check happened.
 */
const MEDIA_COPY = {
  video: { label: "URL do vídeo", title: "Vídeo", mb: LIMITS.mediaMb, formats: MEDIA_FORMATS.video },
  audio: { label: "URL do áudio", title: "Áudio", mb: LIMITS.mediaMb, formats: MEDIA_FORMATS.audio },
  file: { label: "URL do PDF", title: "PDF", mb: LIMITS.mediaMb, formats: MEDIA_FORMATS.file },
} as const;

/**
 * Upload a file to Meta and keep only the returned attachment id.
 *
 * The id is what ships in the message, so a flow using an upload has no
 * external dependency at send time — unlike a URL, which fails the moment
 * the host goes down or the link rotates.
 */
function UploadField({
  kind,
  attachmentId,
  onUploaded,
  onClear,
}: {
  kind: "image" | "audio" | "video" | "file";
  attachmentId?: string;
  onUploaded: (id: string) => void;
  onClear: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (attachmentId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
        <span className="flex-1 text-[11px] text-emerald-800">
          Arquivo enviado ao Instagram
          <span className="ml-1 font-mono text-[10px] text-emerald-600">
            #{attachmentId.slice(-6)}
          </span>
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] font-medium text-emerald-700 underline"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-[12px] font-medium ${
          busy ? "text-neutral-400" : "text-indigo-600 hover:bg-indigo-50"
        }`}
      >
        {busy ? "Enviando…" : "Escolher arquivo do computador"}
        <input
          type="file"
          className="hidden"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              const body = new FormData();
              body.append("file", file);
              body.append("type", kind);
              const res = await fetch("/api/upload", { method: "POST", body });
              const json = (await res.json()) as { attachmentId?: string; error?: string };
              if (!res.ok || !json.attachmentId) {
                throw new Error(json.error ?? "Falha no upload.");
              }
              onUploaded(json.attachmentId);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Falha no upload.");
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}

function MediaProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "video" | "audio" | "file" }>;
  onChange: Update;
}) {
  const copy = MEDIA_COPY[data.kind];

  return (
    <>
      <Field label="Arquivo" hint={`Formatos: ${copy.formats}. Máx. ${copy.mb} MB.`}>
        <UploadField
          kind={data.kind}
          attachmentId={data.attachmentId}
          onUploaded={(id) => onChange({ ...data, attachmentId: id, url: undefined })}
          onClear={() => onChange({ ...data, attachmentId: undefined })}
        />
      </Field>

      {!data.attachmentId && (
        <Field label={`Ou ${copy.label.toLowerCase()}`} hint="Endereço público (https).">
          <TextInput
            value={data.url ?? ""}
            placeholder="https://…"
            onChange={(url) => onChange({ ...data, url: url || undefined })}
          />
        </Field>
      )}

      {data.kind === "file" && (
        <Field label="Nome do arquivo" hint="Só para identificar o bloco no canvas.">
          <TextInput
            value={data.filename ?? ""}
            max={120}
            placeholder="proposta.pdf"
            onChange={(v) => onChange({ ...data, filename: v === "" ? undefined : v })}
          />
        </Field>
      )}

      <p className="rounded-lg bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-500">
        {data.attachmentId
          ? "O arquivo já está no Instagram e pode ser enviado quantas vezes quiser, sem depender de nenhum site."
          : "Com URL, o Instagram baixa o arquivo no momento do envio — se o link sair do ar, o bloco falha."}
      </p>
    </>
  );
}

function AlbumProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "album" }>;
  onChange: Update;
}) {
  const urls = data.urls;
  const set = (next: string[]) => onChange({ ...data, urls: next });

  return (
    <>
      <p className="text-[11px] text-neutral-500">
        Várias imagens em uma só mensagem. Máx. {LIMITS.albumImages} imagens,{" "}
        {LIMITS.imageMb} MB cada ({MEDIA_FORMATS.image}).
      </p>

      <div className="space-y-2">
        {urls.map((u, i) => (
          <div key={i} className="rounded-lg border p-2">
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">
                Imagem {i + 1}
              </span>
              <RowTools
                canUp={i > 0}
                canDown={i < urls.length - 1}
                // The schema requires at least one image.
                canRemove={urls.length > 1}
                removeHint="É preciso ao menos uma imagem."
                onUp={() => set(move(urls, i, i - 1))}
                onDown={() => set(move(urls, i, i + 1))}
                onRemove={() => set(urls.filter((_, n) => n !== i))}
              />
            </div>
            <TextInput
              value={u}
              placeholder="https://…"
              onChange={(v) => set(urls.map((x, n) => (n === i ? v : x)))}
            />
          </div>
        ))}
      </div>

      <AddButton
        label="Adicionar imagem"
        onClick={() => set([...urls, ""])}
        disabled={urls.length >= LIMITS.albumImages}
        atLimit={`O Instagram aceita no máximo ${LIMITS.albumImages} anexos por mensagem.`}
      />
    </>
  );
}

const OP_LABELS: Record<string, string> = {
  equals: "é igual a",
  contains: "contém",
  exists: "existe",
  gt: "é maior que",
  lt: "é menor que",
  before: "é antes de (data)",
  after: "é depois de (data)",
  hasTag: "tem a tag",
};

function ConditionProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "condition" }>;
  onChange: Update;
}) {
  // `exists` and `hasTag` are unary — a value box would just be noise.
  const needsValue = data.op !== "exists" && data.op !== "hasTag";

  return (
    <>
      <Field
        label={data.op === "hasTag" ? "Nome da tag" : "Campo"}
        hint={data.op === "hasTag" ? "A tag procurada no contato." : "Chave salva no contexto."}
      >
        <TextInput mono value={data.key} onChange={(key) => onChange({ ...data, key })} />
      </Field>

      <Field label="Comparação">
        <Select
          value={data.op}
          onChange={(op) =>
            onChange({
              ...data,
              op,
              // Drop a stale value when switching to a unary operator.
              value: op === "exists" || op === "hasTag" ? undefined : data.value,
            })
          }
          options={ConditionOp.options.map((o) => ({ value: o, label: OP_LABELS[o] ?? o }))}
        />
      </Field>

      {needsValue && (
        <Field label="Valor">
          <TextInput
            value={data.value ?? ""}
            onChange={(v) => onChange({ ...data, value: v === "" ? undefined : v })}
          />
        </Field>
      )}

      <p className="rounded-lg bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-500">
        As duas saídas — <b className="text-emerald-600">sim</b> e{" "}
        <b className="text-rose-600">não</b> — precisam estar ligadas para salvar.
      </p>
    </>
  );
}

/** Presets cover the cases people actually pick; the field stays for the rest. */
const DELAY_PRESETS = [
  { label: "30 segundos", seconds: 30 },
  { label: "5 minutos", seconds: 300 },
  { label: "1 hora", seconds: 3600 },
  { label: "1 dia", seconds: 86400 },
];

function DelayProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "delay" }>;
  onChange: Update;
}) {
  const MAX = 60 * 60 * 24 * 30;

  return (
    <>
      <Field label="Esperar (segundos)" hint={`Entre 1 segundo e 30 dias (${MAX}s).`}>
        <input
          type="number"
          min={1}
          max={MAX}
          value={data.seconds}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (!Number.isFinite(n)) return;
            onChange({ ...data, seconds: Math.min(MAX, Math.max(1, n)) });
          }}
          className={INPUT}
        />
      </Field>

      <div className="flex flex-wrap gap-1">
        {DELAY_PRESETS.map((p) => (
          <button
            key={p.seconds}
            onClick={() => onChange({ ...data, seconds: p.seconds })}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
              data.seconds === p.seconds
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={!!data.window}
          onChange={(e) =>
            onChange({
              ...data,
              window: e.target.checked ? { fromHour: 8, toHour: 22 } : undefined,
            })
          }
        />
        Só continuar dentro de um horário
      </label>

      {data.window && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Das">
              <HourSelect
                value={data.window.fromHour}
                onChange={(fromHour) =>
                  onChange({ ...data, window: { ...data.window!, fromHour } })
                }
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Até">
              <HourSelect
                value={data.window.toHour}
                onChange={(toHour) => onChange({ ...data, window: { ...data.window!, toHour } })}
              />
            </Field>
          </div>
        </div>
      )}

      {data.window && (
        <p className="text-[10px] text-neutral-400">
          Se o tempo terminar fora da janela, a conversa continua na próxima abertura.
        </p>
      )}
    </>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={INPUT}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}

const ACTION_LABELS: Record<string, string> = {
  addTag: "Adicionar tag",
  removeTag: "Remover tag",
  setField: "Gravar campo",
  unsetField: "Limpar campo",
  unsubscribe: "Cancelar inscrição",
  resubscribe: "Reativar inscrição",
};

type Op = Extract<FlowNodeData, { kind: "action" }>["ops"][number];

/** A fresh op of the chosen kind, with defaults that already validate. */
function blankOp(op: Op["op"]): Op {
  switch (op) {
    case "addTag":
      return { op: "addTag", tagName: "lead" };
    case "removeTag":
      return { op: "removeTag", tagName: "lead" };
    case "setField":
      return { op: "setField", key: "campo", value: "", valueType: "text" };
    case "unsetField":
      return { op: "unsetField", key: "campo" };
    case "unsubscribe":
      return { op: "unsubscribe" };
    case "resubscribe":
      return { op: "resubscribe" };
  }
}

function ActionProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "action" }>;
  onChange: Update;
}) {
  const ops = data.ops;
  const set = (next: Op[]) => onChange({ ...data, ops: next });
  const patch = (i: number, o: Op) => set(ops.map((x, n) => (n === i ? o : x)));

  return (
    <>
      <p className="text-[11px] text-neutral-500">
        Executa em ordem e segue adiante, sem mandar mensagem. Máx. 10 ações.
      </p>

      <div className="space-y-2">
        {ops.map((o, i) => (
          <div key={i} className="rounded-lg border p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">
                Ação {i + 1}
              </span>
              <RowTools
                canUp={i > 0}
                canDown={i < ops.length - 1}
                canRemove={ops.length > 1}
                removeHint="É preciso ao menos uma ação."
                onUp={() => set(move(ops, i, i - 1))}
                onDown={() => set(move(ops, i, i + 1))}
                onRemove={() => set(ops.filter((_, n) => n !== i))}
              />
            </div>

            <Select
              value={o.op}
              onChange={(next) => patch(i, blankOp(next))}
              options={(Object.keys(ACTION_LABELS) as Op["op"][]).map((k) => ({
                value: k,
                label: ACTION_LABELS[k]!,
              }))}
            />

            {(o.op === "addTag" || o.op === "removeTag") && (
              <div className="mt-1.5">
                <TextInput
                  value={o.tagName}
                  placeholder="nome da tag"
                  onChange={(tagName) => patch(i, { ...o, tagName })}
                />
              </div>
            )}

            {o.op === "unsetField" && (
              <div className="mt-1.5">
                <TextInput mono value={o.key} onChange={(key) => patch(i, { ...o, key })} />
              </div>
            )}

            {o.op === "unsubscribe" && (
              <p className="mt-1.5 text-[11px] text-neutral-500">
                O contato deixa de receber disparos e novos fluxos até enviar <b>voltar</b>.
              </p>
            )}

            {o.op === "setField" && (
              <>
                <div className="mt-1.5">
                  <TextInput
                    mono
                    value={o.key}
                    placeholder="nome_do_campo"
                    onChange={(key) => patch(i, { ...o, key })}
                  />
                </div>
                <div className="mt-1.5">
                  <TextInput
                    value={o.value}
                    placeholder="valor"
                    onChange={(value) => patch(i, { ...o, value })}
                  />
                </div>
                <div className="mt-1.5">
                  <Select
                    value={o.valueType}
                    onChange={(valueType) => patch(i, { ...o, valueType })}
                    options={[
                      { value: "text", label: "Texto" },
                      { value: "number", label: "Número" },
                      { value: "date", label: "Data" },
                      { value: "boolean", label: "Sim/não" },
                    ]}
                  />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <AddButton
        label="Adicionar ação"
        onClick={() => set([...ops, blankOp("addTag")])}
        disabled={ops.length >= 10}
        atLimit="Máximo de 10 ações por bloco."
      />
    </>
  );
}

function RandomProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "random" }>;
  onChange: Update;
}) {
  const w = data.weights;
  const sum = w.reduce((a, b) => a + b, 0);

  /** Even split, remainder pushed onto the first branch so it lands on 100. */
  const balance = (n: number) => {
    const base = Math.floor(100 / n);
    return Array.from({ length: n }, (_, i) => (i === 0 ? 100 - base * (n - 1) : base));
  };

  return (
    <>
      <p className="text-[11px] text-neutral-500">
        Divide o tráfego entre saídas. As porcentagens precisam somar 100%.
      </p>

      {w.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-16 text-[11px] text-neutral-500">Saída {i + 1}</span>
          <input
            type="number"
            min={1}
            max={100}
            value={v}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (!Number.isFinite(n)) return;
              onChange({
                ...data,
                weights: w.map((x, k) => (k === i ? Math.min(100, Math.max(1, n)) : x)),
              });
            }}
            className={`${INPUT} flex-1`}
          />
        </div>
      ))}

      <div
        className={`text-[11px] font-medium ${sum === 100 ? "text-emerald-600" : "text-rose-600"}`}
      >
        Soma: {sum}%{sum !== 100 && " — precisa dar 100%"}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onChange({ ...data, weights: balance(w.length) })}
          className="flex-1 rounded-lg border px-2 py-1 text-[11px]"
        >
          Equilibrar
        </button>
        <button
          onClick={() => onChange({ ...data, weights: balance(w.length + 1) })}
          disabled={w.length >= 4}
          className="flex-1 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-40"
        >
          + Saída
        </button>
        <button
          onClick={() => onChange({ ...data, weights: balance(w.length - 1) })}
          disabled={w.length <= 2}
          className="flex-1 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-40"
        >
          − Saída
        </button>
      </div>
    </>
  );
}

/** Legacy node. Editable so old flows stay maintainable, with a nudge forward. */
function TagProps({
  data,
  onChange,
}: {
  data: Extract<FlowNodeData, { kind: "tag" }>;
  onChange: Update;
}) {
  return (
    <>
      <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
        Bloco antigo, mantido para os fluxos que já o usam. Em blocos novos,
        prefira <b>Ações</b>.
      </p>
      <Field label="O que fazer">
        <Select
          value={data.action}
          onChange={(action) => onChange({ ...data, action })}
          options={[
            { value: "add", label: "Adicionar tag" },
            { value: "remove", label: "Remover tag" },
          ]}
        />
      </Field>
      <Field label="Tag">
        <TextInput value={data.tagName} onChange={(tagName) => onChange({ ...data, tagName })} />
      </Field>
    </>
  );
}

function titleOf(data: FlowNodeData): string {
  const names: Record<FlowNodeData["kind"], string> = {
    message: "Enviar mensagem",
    question: "Perguntar",
    quickreply: "Resposta rápida",
    carousel: "Carrossel",
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    file: "PDF",
    album: "Álbum",
    condition: "Condição",
    delay: "Atraso inteligente",
    action: "Ações",
    random: "Randomizador",
    tag: "Tag (antigo)",
    end: "Fim",
  };
  return names[data.kind];
}
