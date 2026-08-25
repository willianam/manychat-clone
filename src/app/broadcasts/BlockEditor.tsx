"use client";

import { Plus, Trash2 } from "lucide-react";
import { LIMITS, byteLength, type FlowButton, type FlowNodeData } from "../../lib/flow-schema";
import { newButton, retypeButton, uid } from "../../lib/flow-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/ui/cn";

/**
 * The block editor of the broadcast composer.
 *
 * A subset of the flow editor's properties panel: the four sending kinds a
 * broadcast is likely to want (text with buttons, image, quick replies,
 * carousel), edited with the same primitives and the same Instagram caps.
 * The panel's own editors are not exported and are tied to the canvas, so
 * this is a sibling, not a copy of the whole thing: postback buttons and
 * quick replies are accepted but explained as inert, because a broadcast
 * has no session for a tap to continue.
 */

export type BlockKind = "message" | "image" | "quickreply" | "carousel";
export type Block = Extract<FlowNodeData, { kind: BlockKind }>;

export const BLOCK_LABEL: Record<BlockKind, string> = {
  message: "Texto com botões",
  image: "Imagem",
  quickreply: "Respostas rápidas",
  carousel: "Carrossel",
};

export function blankBlock(kind: BlockKind): Block {
  switch (kind) {
    case "message":
      return { kind: "message", text: "" };
    case "image":
      return { kind: "image", url: "", caption: "" };
    case "quickreply":
      return {
        kind: "quickreply",
        text: "",
        saveAs: "escolha",
        options: [{ id: uid("o"), title: "Opção 1" }],
      };
    case "carousel":
      return {
        kind: "carousel",
        cards: [{ id: uid("c"), title: "", buttons: [newButton("Ver mais")] }],
      };
  }
}

export function BlockEditor({ value, onChange }: { value: Block; onChange: (b: Block) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="bc-block-kind">Tipo de bloco</Label>
        <Select value={value.kind} onValueChange={(k) => onChange(blankBlock(k as BlockKind))}>
          <SelectTrigger id="bc-block-kind" className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BLOCK_LABEL) as BlockKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {BLOCK_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.kind === "message" && <MessageFields data={value} onChange={onChange} />}
      {value.kind === "image" && <ImageFields data={value} onChange={onChange} />}
      {value.kind === "quickreply" && <QuickReplyFields data={value} onChange={onChange} />}
      {value.kind === "carousel" && <CarouselFields data={value} onChange={onChange} />}
    </div>
  );
}

function Counter({ text, max }: { text: string; max: number }) {
  const len = byteLength(text);
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        len > max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {len}/{max}
    </span>
  );
}

function MessageFields({
  data,
  onChange,
}: {
  data: Extract<Block, { kind: "message" }>;
  onChange: (b: Block) => void;
}) {
  const buttons = data.buttons ?? [];
  const max = buttons.length ? LIMITS.buttonTemplateText : LIMITS.messageText;
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="bc-block-text">Texto</Label>
          <Counter text={data.text} max={max} />
        </div>
        <Textarea
          id="bc-block-text"
          rows={4}
          value={data.text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
        />
        {buttons.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Com botões, o Instagram corta o texto em {LIMITS.buttonTemplateText} caracteres.
          </p>
        )}
      </div>
      <ButtonList
        label="Botões"
        buttons={buttons}
        max={LIMITS.buttons}
        onChange={(next) => onChange({ ...data, buttons: next.length ? next : undefined })}
      />
    </>
  );
}

function ImageFields({
  data,
  onChange,
}: {
  data: Extract<Block, { kind: "image" }>;
  onChange: (b: Block) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="bc-image-url">URL da imagem</Label>
        <Input
          id="bc-image-url"
          placeholder="https://…"
          value={data.url ?? ""}
          onChange={(e) => onChange({ ...data, url: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Endereço público (https). PNG ou JPEG até {LIMITS.imageMb} MB.
        </p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="bc-image-caption">Legenda (só na prévia do inbox)</Label>
          <Counter text={data.caption ?? ""} max={LIMITS.messageText} />
        </div>
        <Textarea
          id="bc-image-caption"
          rows={2}
          value={data.caption ?? ""}
          onChange={(e) => onChange({ ...data, caption: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

function QuickReplyFields({
  data,
  onChange,
}: {
  data: Extract<Block, { kind: "quickreply" }>;
  onChange: (b: Block) => void;
}) {
  const opts = data.options;
  const set = (options: typeof opts) => onChange({ ...data, options });
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="bc-qr-text">Texto</Label>
          <Counter text={data.text} max={LIMITS.messageText} />
        </div>
        <Textarea
          id="bc-qr-text"
          rows={3}
          value={data.text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Opções ({opts.length}/{LIMITS.quickReplies})
        </legend>
        <p className="text-xs text-muted-foreground">
          Num disparo, tocar numa opção só responde com o título: não há fluxo para continuar.
        </p>
        {opts.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <Label htmlFor={`bc-qr-opt-${o.id}`} className="sr-only">
              Opção {i + 1}
            </Label>
            <Input
              id={`bc-qr-opt-${o.id}`}
              value={o.title}
              maxLength={LIMITS.quickReplyTitle}
              onChange={(e) =>
                set(opts.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover opção ${i + 1}`}
              disabled={opts.length <= 1}
              onClick={() => set(opts.filter((_, n) => n !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={opts.length >= LIMITS.quickReplies}
          onClick={() => set([...opts, { id: uid("o"), title: `Opção ${opts.length + 1}` }])}
        >
          <Plus aria-hidden />
          Adicionar opção
        </Button>
      </fieldset>
    </>
  );
}

function CarouselFields({
  data,
  onChange,
}: {
  data: Extract<Block, { kind: "carousel" }>;
  onChange: (b: Block) => void;
}) {
  const cards = data.cards;
  const set = (next: typeof cards) => onChange({ ...data, cards: next });
  const patch = (i: number, p: Partial<(typeof cards)[number]>) =>
    set(cards.map((c, n) => (n === i ? { ...c, ...p } : c)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Até {LIMITS.carouselCards} cards, {LIMITS.carouselButtons} botões por card.
      </p>
      {cards.map((c, i) => (
        <div key={c.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Card {i + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover card ${i + 1}`}
              disabled={cards.length <= 1}
              onClick={() => set(cards.filter((_, n) => n !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`bc-card-title-${c.id}`}>Título</Label>
            <Input
              id={`bc-card-title-${c.id}`}
              maxLength={80}
              value={c.title}
              onChange={(e) => patch(i, { title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`bc-card-sub-${c.id}`}>Subtítulo</Label>
            <Input
              id={`bc-card-sub-${c.id}`}
              maxLength={80}
              value={c.subtitle ?? ""}
              onChange={(e) => patch(i, { subtitle: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`bc-card-img-${c.id}`}>Imagem (URL)</Label>
            <Input
              id={`bc-card-img-${c.id}`}
              placeholder="https://…"
              value={c.imageUrl ?? ""}
              onChange={(e) => patch(i, { imageUrl: e.target.value || undefined })}
            />
          </div>
          <ButtonList
            label="Botões do card"
            buttons={c.buttons ?? []}
            max={LIMITS.carouselButtons}
            onChange={(next) => patch(i, { buttons: next.length ? next : undefined })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={cards.length >= LIMITS.carouselCards}
        onClick={() =>
          set([...cards, { id: uid("c"), title: "", buttons: [newButton("Ver mais")] }])
        }
      >
        <Plus aria-hidden />
        Adicionar card
      </Button>
    </div>
  );
}

function ButtonList({
  label,
  buttons,
  max,
  onChange,
}: {
  label: string;
  buttons: FlowButton[];
  max: number;
  onChange: (buttons: FlowButton[]) => void;
}) {
  const set = (i: number, b: FlowButton) => onChange(buttons.map((x, n) => (n === i ? b : x)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {label} ({buttons.length}/{max})
      </legend>
      <p className="text-xs text-muted-foreground">
        Num disparo só “abre um link” faz algo; um botão que “continua o fluxo” não tem para onde
        ir.
      </p>
      {buttons.map((b, i) => (
        <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <Label htmlFor={`bc-btn-title-${b.id}`} className="sr-only">
            Texto do botão {i + 1}
          </Label>
          <Input
            id={`bc-btn-title-${b.id}`}
            className="w-40"
            maxLength={20}
            placeholder="Texto do botão"
            value={b.title}
            onChange={(e) => set(i, { ...b, title: e.target.value })}
          />
          <Label htmlFor={`bc-btn-type-${b.id}`} className="sr-only">
            Tipo do botão {i + 1}
          </Label>
          <Select
            value={b.type}
            onValueChange={(t) => set(i, retypeButton(b, t as FlowButton["type"]))}
          >
            <SelectTrigger id={`bc-btn-type-${b.id}`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="url">Abre um link</SelectItem>
              <SelectItem value="postback">Continua o fluxo</SelectItem>
            </SelectContent>
          </Select>
          {b.type === "url" && (
            <>
              <Label htmlFor={`bc-btn-url-${b.id}`} className="sr-only">
                Link do botão {i + 1}
              </Label>
              <Input
                id={`bc-btn-url-${b.id}`}
                className="min-w-0 flex-1"
                placeholder="https://…"
                value={b.url}
                onChange={(e) => set(i, { ...b, url: e.target.value })}
              />
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover botão ${i + 1}`}
            onClick={() => onChange(buttons.filter((_, n) => n !== i))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={buttons.length >= max}
        onClick={() => onChange([...buttons, retypeButton(newButton(), "url")])}
      >
        <Plus aria-hidden />
        Adicionar botão
      </Button>
    </fieldset>
  );
}
