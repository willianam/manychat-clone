"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { setField, unsetField } from "./actions";
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
import { withToast } from "@/lib/ui/action-toast";

export type FieldDef = {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  defaultValue: string | null;
};

const BOOL_NONE = "__none__";

/**
 * One editable row per registered field, typed after the registry: a
 * number field gets a numeric input, a date a date picker, a boolean a
 * yes/no select. Values are saved on blur / change; the server coerces to
 * the canonical form and hands it back so the row shows what was stored.
 */
export function FieldsEditor({
  contactId,
  fields,
  values,
}: {
  contactId: string;
  fields: FieldDef[];
  values: Record<string, string>;
}) {
  const router = useRouter();

  if (fields.length === 0) {
    return (
      <section aria-labelledby="fields-h" className="rounded-xl border bg-card p-4">
        <h2 id="fields-h" className="text-sm font-semibold">
          Campos
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum campo registrado. Crie um em Campos ou deixe um fluxo salvar o primeiro.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="fields-h" className="rounded-xl border bg-card p-4">
      <h2 id="fields-h" className="text-sm font-semibold">
        Campos
      </h2>
      <dl className="mt-2 divide-y">
        {fields.map((f) => (
          <FieldRow
            key={f.key}
            contactId={contactId}
            field={f}
            value={values[f.key] ?? ""}
            onSaved={() => router.refresh()}
          />
        ))}
      </dl>
    </section>
  );
}

function FieldRow({
  contactId,
  field,
  value,
  onSaved,
}: {
  contactId: string;
  field: FieldDef;
  value: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();
  const id = `field-${field.key}`;

  const save = (next: string) => {
    if (next === value) return;
    start(async () => {
      const stored = await withToast(() => setField(contactId, field.key, next), {
        success: `Campo "${field.label}" salvo.`,
        error: "Não foi possível salvar o campo.",
      });
      if (stored === undefined) setDraft(value);
      else {
        setDraft(stored);
        onSaved();
      }
    });
  };

  const clear = () =>
    start(async () => {
      const ok = await withToast(() => unsetField(contactId, field.key).then(() => true), {
        success: `Campo "${field.label}" limpo.`,
        error: "Não foi possível limpar o campo.",
      });
      if (ok !== undefined) {
        setDraft("");
        onSaved();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <dt className="w-36 shrink-0">
        <Label htmlFor={id} className="font-normal text-muted-foreground">
          {field.label}
          {field.label !== field.key && (
            <code className="ml-1 text-[10px] text-neutral-400">{field.key}</code>
          )}
        </Label>
      </dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1">
        {field.type === "BOOLEAN" ? (
          <Select
            value={draft === "" ? BOOL_NONE : draft === "true" ? "true" : "false"}
            onValueChange={(v) => {
              if (v === BOOL_NONE) return;
              setDraft(v);
              save(v);
            }}
            disabled={pending}
          >
            <SelectTrigger id={id} className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BOOL_NONE}>—</SelectItem>
              <SelectItem value="true">sim</SelectItem>
              <SelectItem value="false">não</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"}
            step={field.type === "NUMBER" ? "any" : undefined}
            value={field.type === "DATE" ? draft.slice(0, 10) : draft}
            disabled={pending}
            placeholder={field.defaultValue ?? undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(value);
            }}
            className="h-8 max-w-xs"
          />
        )}
        {value !== "" && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={`Limpar ${field.label}`}
            disabled={pending}
            onClick={clear}
          >
            <Eraser aria-hidden />
          </Button>
        )}
      </dd>
    </div>
  );
}
