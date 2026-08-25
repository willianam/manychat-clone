"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createSegmentAction, updateSegmentAction } from "./actions";
import { countSegmentAction } from "./preview-action";
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
import type { SegmentRule, SegmentRules } from "@/lib/segment-rules";
import {
  OPS,
  RULE_KINDS,
  defaultRule,
  rulesValid,
  valueInput,
  withOp,
  type BuilderContext,
  type RuleKind,
} from "@/lib/segment-builder";

/**
 * One group of rules joined by AND or OR, each rule a (kind, operator,
 * value) row. The count under the rules is a real `countSegment` on the
 * server, debounced so typing a value does not query per keystroke.
 *
 * Nested groups are not offered: the stored shape (lib/segment-rules.ts)
 * is one flat group, and the builder does not pretend otherwise.
 */
export function SegmentBuilder({
  segment,
  ctx,
  debounceMs = 400,
}: {
  segment?: { id: string; name: string; rules: SegmentRules };
  ctx: BuilderContext;
  debounceMs?: number;
}) {
  const id = useId();
  const [name, setName] = useState(segment?.name ?? "");
  const [combinator, setCombinator] = useState<"and" | "or">(segment?.rules.combinator ?? "and");
  // Rows carry a client-side id so React remounts a row instead of reusing
  // it when one above is removed. Radix Select re-emits its native change
  // when the value prop moves, and a reused row would then read an option
  // that is not rendered yet — the operator would come back as "".
  const [rows, setRows] = useState<Array<{ id: number; rule: SegmentRule }>>(() =>
    (segment?.rules.rules ?? []).map((rule, i) => ({ id: i, rule })),
  );
  const [nextId, setNextId] = useState(rows.length);
  const rules = rows.map((r) => r.rule);
  const [count, setCount] = useState<number | null>(null);
  const [counting, startCount] = useTransition();
  const [saving, startSave] = useTransition();

  const draft = { combinator, rules };
  const valid = rulesValid(draft);

  useEffect(() => {
    if (!valid) {
      setCount(null);
      return;
    }
    const t = setTimeout(() => {
      startCount(async () => {
        setCount(await countSegmentAction(draft));
      });
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), valid, debounceMs]);

  const update = (id: number, next: SegmentRule) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, rule: next } : r)));
  const remove = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));
  const add = () => {
    setRows((prev) => [...prev, { id: nextId, rule: defaultRule("tag", ctx) }]);
    setNextId((n) => n + 1);
  };

  const save = () =>
    startSave(async () => {
      await withToast(
        () =>
          segment ? updateSegmentAction(segment.id, name, draft) : createSegmentAction(name, draft),
        {
          success: segment ? "Segmento salvo." : "Segmento criado.",
          error: "Não foi possível salvar.",
        },
      );
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Nome</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="ex: quentes desta semana"
          className="max-w-md"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="flex items-center gap-2 text-sm font-medium">
          Contatos que atendem
          <Select value={combinator} onValueChange={(v) => setCombinator(v as "and" | "or")}>
            <SelectTrigger aria-label="Combinação" className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">todas as regras (E)</SelectItem>
              <SelectItem value="or">qualquer regra (OU)</SelectItem>
            </SelectContent>
          </Select>
        </legend>

        {rules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sem regras, o segmento é todo mundo. Adicione a primeira regra.
          </p>
        )}

        <ol className="space-y-2">
          {rows.map(({ id: rowId, rule }, i) => (
            <li
              key={rowId}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2"
            >
              <RuleRow rule={rule} ctx={ctx} index={i} onChange={(next) => update(rowId, next)} />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-auto h-8 w-8 text-muted-foreground"
                aria-label={`Remover regra ${i + 1}`}
                onClick={() => remove(rowId)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>

        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus aria-hidden />
          Adicionar regra
        </Button>
      </fieldset>

      <p className="text-sm" aria-live="polite" aria-busy={counting}>
        {!valid ? (
          <span className="text-amber-800">Complete as regras para ver a contagem.</span>
        ) : count === null ? (
          <span className="text-muted-foreground">Contando…</span>
        ) : (
          <>
            <strong className="tabular-nums">{count}</strong>{" "}
            {count === 1 ? "contato atende" : "contatos atendem"}
            {counting && <span className="text-muted-foreground"> · atualizando…</span>}
          </>
        )}
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !valid || !name.trim()}>
          {saving ? "Salvando…" : segment ? "Salvar segmento" : "Criar segmento"}
        </Button>
      </div>
    </form>
  );
}

const BOOL = { true: "inscrito", false: "descadastrado" } as const;

function RuleRow({
  rule,
  ctx,
  index,
  onChange,
}: {
  rule: SegmentRule;
  ctx: BuilderContext;
  index: number;
  onChange: (next: SegmentRule) => void;
}) {
  const n = index + 1;
  const input = valueInput(rule);
  const value = "value" in rule ? rule.value : undefined;

  return (
    <>
      <Select
        value={rule.kind}
        onValueChange={(kind) => kind && onChange(defaultRule(kind as RuleKind, ctx))}
      >
        <SelectTrigger aria-label={`Tipo da regra ${n}`} className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_KINDS.map((k) => (
            <SelectItem key={k.kind} value={k.kind}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {rule.kind === "field" && (
        <Select
          value={rule.key || "__none__"}
          onValueChange={(key) => key && key !== "__none__" && onChange({ ...rule, key })}
        >
          <SelectTrigger aria-label={`Campo da regra ${n}`} className="h-8 w-40">
            <SelectValue placeholder="campo…" />
          </SelectTrigger>
          <SelectContent>
            {ctx.fields.length === 0 && <SelectItem value="__none__">nenhum campo</SelectItem>}
            {ctx.fields.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Keyed by kind so the operator list remounts with the right options. */}
      <Select
        key={rule.kind}
        value={rule.op}
        onValueChange={(op) => op && onChange(withOp(rule, op))}
      >
        <SelectTrigger aria-label={`Operador da regra ${n}`} className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS[rule.kind].map((o) => (
            <SelectItem key={o.op} value={o.op}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {input === "tag" && (
        <Select
          value={String(value ?? "") || "__none__"}
          onValueChange={(v) =>
            v && v !== "__none__" && onChange({ ...rule, value: v } as SegmentRule)
          }
        >
          <SelectTrigger aria-label={`Etiqueta da regra ${n}`} className="h-8 w-40">
            <SelectValue placeholder="etiqueta…" />
          </SelectTrigger>
          <SelectContent>
            {ctx.tags.length === 0 && <SelectItem value="__none__">nenhuma etiqueta</SelectItem>}
            {ctx.tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {input === "boolean" && (
        <Select
          value={value ? "true" : "false"}
          onValueChange={(v) => v && onChange({ ...rule, value: v === "true" } as SegmentRule)}
        >
          <SelectTrigger aria-label={`Valor da regra ${n}`} className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{BOOL.true}</SelectItem>
            <SelectItem value="false">{BOOL.false}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {(input === "text" || input === "date") && (
        <Input
          type={input === "date" ? "date" : "text"}
          aria-label={`Valor da regra ${n}`}
          value={String(value ?? "")}
          onChange={(e) => onChange({ ...rule, value: e.target.value } as SegmentRule)}
          className="h-8 w-44"
          placeholder={rule.kind === "source" ? "dm, comment, ref:codigo…" : undefined}
        />
      )}
    </>
  );
}
