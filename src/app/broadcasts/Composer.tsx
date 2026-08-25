"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Save, Send } from "lucide-react";
import type { FlowGraph } from "../../lib/flow-schema";
import { MESSAGE_TAGS, MESSAGE_TAG_LABELS, type MessageTag } from "../../lib/messaging-window";
import { contentIssues, previewGraph, type ComposerBody } from "../../lib/broadcast-preview";
import { PreviewPhone } from "../flows/[id]/preview/PreviewPhone";
import { AudiencePicker } from "./AudiencePicker";
import { BlockEditor, blankBlock, type Block } from "./BlockEditor";
import { createBroadcast } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/ui/action-toast";
import { cn } from "@/lib/ui/cn";

type Flow = { id: string; name: string; graph: FlowGraph | null };

/** Why the tag exists, in the owner's words. Shown under the picker. */
const TAG_HELP: Record<MessageTag, string> = {
  HUMAN_AGENT:
    "Estende a janela para 7 dias. Exige a permissão human_agent e uma pessoa de verdade respondendo; não use para promoção.",
};

const NO_TAG = "__none__";

/**
 * The broadcast composer: what to send, to whom, when — with the phone
 * preview beside it so copy is read as the contact will read it.
 *
 * The form posts to `createBroadcast` with an `intent`: "draft" saves,
 * "send" saves and enqueues (a future `scheduledAt` makes the drainers wait).
 * `parseBroadcastForm` owns validation; this component only decides which
 * fields exist in the post.
 */
export function Composer({
  tags,
  segments,
  flows,
  timeZone,
}: {
  tags: Array<{ id: string; name: string; color: string }>;
  segments: Array<{ id: string; name: string }>;
  flows: Flow[];
  timeZone: string;
}) {
  const [mode, setMode] = useState<"text" | "content" | "flow">("text");
  const [text, setText] = useState("");
  const [block, setBlock] = useState<Block>(() => blankBlock("message"));
  const [flowId, setFlowId] = useState(flows[0]?.id ?? "");
  const [tag, setTag] = useState<string>(NO_TAG);
  const [when, setWhen] = useState<"now" | "later">("now");
  // Reported by the AudiencePicker so the send confirmation can name the
  // number of people about to be messaged. Null while the count is loading.
  const [targeted, setTargeted] = useState<number | null>(null);

  const body = useMemo<ComposerBody>(() => {
    if (mode === "text") return { mode: "text", text };
    if (mode === "content") return { mode: "content", content: block };
    return { mode: "flow", graph: flows.find((f) => f.id === flowId)?.graph ?? null };
  }, [mode, text, block, flows, flowId]);

  const graph = useMemo(() => previewGraph(body), [body]);
  const issues = mode === "content" ? contentIssues(block) : [];
  const emptyBody =
    (mode === "text" && text.trim() === "") ||
    (mode === "flow" && !flowId) ||
    (mode === "content" && issues.length > 0);

  const action = async (formData: FormData) => {
    await withToast(() => createBroadcast(formData), {
      error: "Não foi possível salvar o disparo.",
    });
  };

  return (
    <form action={action} className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conteúdo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-name">Nome interno</Label>
              <Input id="bc-name" name="name" maxLength={120} placeholder="ex: promoção de sexta" />
            </div>

            <Segmented
              label="O que enviar"
              value={mode}
              onChange={setMode}
              options={[
                { value: "text", label: "Texto" },
                { value: "content", label: "Bloco" },
                { value: "flow", label: "Enviar um fluxo", disabled: flows.length === 0 },
              ]}
            />

            {mode === "text" && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-text">Mensagem</Label>
                <Textarea
                  id="bc-text"
                  name="text"
                  rows={5}
                  maxLength={1000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}

            {mode === "content" && (
              <>
                <input type="hidden" name="content" value={JSON.stringify(block)} />
                <BlockEditor value={block} onChange={setBlock} />
                {issues.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {mode === "flow" && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-flow">Fluxo</Label>
                <input type="hidden" name="flowId" value={flowId} />
                <Select value={flowId} onValueChange={setFlowId}>
                  <SelectTrigger id="bc-flow" className="w-72">
                    <SelectValue placeholder="escolha…" />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Cada destinatário entra no fluxo como se tivesse acionado um gatilho. Só fluxos
                  ativos aparecem aqui.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Público</CardTitle>
          </CardHeader>
          <CardContent>
            <AudiencePicker tags={tags} segments={segments} onTargetedChange={setTargeted} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entrega</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-tag">Message tag (opcional)</Label>
              <input type="hidden" name="tag" value={tag === NO_TAG ? "" : tag} />
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger id="bc-tag" className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TAG}>Sem tag (só dentro da janela de 24h)</SelectItem>
                  {MESSAGE_TAGS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {MESSAGE_TAG_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tag === NO_TAG
                  ? "Uma tag permite enviar fora da janela em casos específicos. Usar fora deles pode derrubar a conta."
                  : TAG_HELP[tag as MessageTag]}
              </p>
            </div>

            <Segmented
              label="Quando"
              value={when}
              onChange={setWhen}
              options={[
                { value: "now", label: "Enviar agora" },
                { value: "later", label: "Agendar" },
              ]}
            />

            {when === "later" && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-when">Data e hora</Label>
                <Input
                  id="bc-when"
                  type="datetime-local"
                  name="scheduledAt"
                  required
                  className="w-auto"
                />
                <p className="text-xs text-muted-foreground">
                  Horário de {timeZone}. O disparo fica na fila e sai nesse momento; a janela de 24h
                  é checada na hora do envio, não agora.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton name="intent" value="draft" variant="outline" pendingLabel="Salvando…">
            <Save aria-hidden />
            Salvar rascunho
          </SubmitButton>
          {/*
            A broadcast is the least reversible action in the app: once the
            messages leave, nothing brings them back. Deleting a tag already
            asks for confirmation, so sending to everyone certainly should.
          */}
          <ConfirmSubmitButton
            name="intent"
            value="send"
            disabled={emptyBody}
            title={when === "later" ? "Agendar este disparo?" : "Enviar este disparo agora?"}
            description={
              <>
                {targeted === null
                  ? "O disparo vai para o público selecionado."
                  : `O disparo vai para ${targeted} contato${targeted === 1 ? "" : "s"}.`}{" "}
                {when === "later"
                  ? "Você ainda pode cancelar antes da hora marcada."
                  : "As mensagens saem imediatamente e não há como recolhê-las."}
              </>
            }
            confirmLabel={when === "later" ? "Agendar" : "Enviar agora"}
          >
            {when === "later" ? <CalendarClock aria-hidden /> : <Send aria-hidden />}
            {when === "later" ? "Agendar" : "Enviar agora"}
          </ConfirmSubmitButton>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        {graph ? (
          <PreviewPhone graph={graph} name="Prévia do disparo" />
        ) : (
          <p className="text-sm text-muted-foreground">
            Este fluxo não tem um grafo válido para pré-visualizar.
          </p>
        )}
      </div>
    </form>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium leading-none">{label}</legend>
      <div
        role="radiogroup"
        className="mt-2 inline-flex items-center rounded-lg bg-muted p-1 text-sm"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
              value === o.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
