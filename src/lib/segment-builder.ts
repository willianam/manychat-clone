import { SegmentRules, type SegmentRule } from "./segment-rules";

/**
 * The rule builder's vocabulary: which kinds exist, which operators each
 * kind takes, what a fresh rule of a kind looks like, and how a rule reads
 * in Portuguese. Pure so the builder, the list page and the tests share it;
 * the shape itself stays defined once in lib/segment-rules.ts.
 */

export type RuleKind = SegmentRule["kind"];

export const RULE_KINDS: Array<{ kind: RuleKind; label: string }> = [
  { kind: "tag", label: "Etiqueta" },
  { kind: "field", label: "Campo" },
  { kind: "lastInbound", label: "Última interação" },
  { kind: "window", label: "Janela de 24h" },
  { kind: "subscribed", label: "Inscrito" },
  { kind: "source", label: "Origem" },
  { kind: "createdAt", label: "Criado em" },
];

export const OPS: Record<RuleKind, Array<{ op: string; label: string }>> = {
  tag: [
    { op: "has", label: "tem" },
    { op: "missing", label: "não tem" },
  ],
  field: [
    { op: "equals", label: "é igual a" },
    { op: "contains", label: "contém" },
    { op: "exists", label: "está preenchido" },
    { op: "missing", label: "está vazio" },
    { op: "gt", label: "é maior que" },
    { op: "lt", label: "é menor que" },
    { op: "after", label: "é depois de" },
    { op: "before", label: "é antes de" },
  ],
  lastInbound: [
    { op: "after", label: "depois de" },
    { op: "before", label: "antes de" },
    { op: "never", label: "nunca escreveu" },
  ],
  window: [
    { op: "in", label: "dentro" },
    { op: "out", label: "fora" },
  ],
  subscribed: [{ op: "is", label: "é" }],
  source: [
    { op: "equals", label: "é igual a" },
    { op: "startsWith", label: "começa com" },
  ],
  createdAt: [
    { op: "after", label: "depois de" },
    { op: "before", label: "antes de" },
  ],
};

/** What input the value cell needs for a rule. */
export type ValueInput = "none" | "tag" | "text" | "date" | "boolean";

export function valueInput(rule: SegmentRule): ValueInput {
  switch (rule.kind) {
    case "tag":
      return "tag";
    case "field":
      if (rule.op === "exists" || rule.op === "missing") return "none";
      return rule.op === "before" || rule.op === "after" ? "date" : "text";
    case "lastInbound":
      return rule.op === "never" ? "none" : "date";
    case "window":
      return "none";
    case "subscribed":
      return "boolean";
    case "source":
      return "text";
    case "createdAt":
      return "date";
  }
}

export type BuilderContext = {
  tags: Array<{ id: string; name: string }>;
  fields: Array<{ key: string; label: string }>;
};

/** A rule of `kind` with sensible defaults, so a new row is valid as soon as it appears when it can be. */
export function defaultRule(kind: RuleKind, ctx: BuilderContext, today = new Date()): SegmentRule {
  const day = today.toISOString().slice(0, 10);
  switch (kind) {
    case "tag":
      return { kind, op: "has", value: ctx.tags[0]?.id ?? "" };
    case "field":
      return { kind, key: ctx.fields[0]?.key ?? "", op: "exists" };
    case "lastInbound":
      return { kind, op: "after", value: day };
    case "window":
      return { kind, op: "in" };
    case "subscribed":
      return { kind, op: "is", value: true };
    case "source":
      return { kind, op: "equals", value: "dm" };
    case "createdAt":
      return { kind, op: "after", value: day };
  }
}

/** Same rule with a new operator, dropping a value the new operator does not take. */
export function withOp(rule: SegmentRule, op: string): SegmentRule {
  const next = { ...rule, op } as SegmentRule;
  if (valueInput(next) === "none" && "value" in next && next.kind !== "subscribed") {
    const { value: _drop, ...rest } = next as SegmentRule & { value?: unknown };
    void _drop;
    return rest as SegmentRule;
  }
  if (valueInput(next) === "date" && (!("value" in next) || !next.value)) {
    return { ...next, value: new Date().toISOString().slice(0, 10) } as SegmentRule;
  }
  return next;
}

export function describeRule(rule: SegmentRule, ctx: BuilderContext): string {
  const opLabel = (kind: RuleKind, op: string) => OPS[kind].find((o) => o.op === op)?.label ?? op;
  switch (rule.kind) {
    case "tag": {
      const name = ctx.tags.find((t) => t.id === rule.value)?.name ?? rule.value;
      return `${opLabel("tag", rule.op)} a etiqueta "${name}"`;
    }
    case "field": {
      const label = ctx.fields.find((f) => f.key === rule.key)?.label ?? rule.key;
      const base = `campo "${label}" ${opLabel("field", rule.op)}`;
      return valueInput(rule) === "none" ? base : `${base} ${rule.value ?? ""}`.trim();
    }
    case "lastInbound":
      return rule.op === "never"
        ? "nunca escreveu"
        : `última interação ${opLabel("lastInbound", rule.op)} ${fmtDay(rule.value)}`;
    case "window":
      return rule.op === "in" ? "dentro da janela de 24h" : "fora da janela de 24h";
    case "subscribed":
      return rule.value ? "inscrito" : "descadastrado";
    case "source":
      return `origem ${opLabel("source", rule.op)} "${rule.value}"`;
    case "createdAt":
      return `criado ${opLabel("createdAt", rule.op)} ${fmtDay(rule.value)}`;
  }
}

export function describeRules(rules: SegmentRules, ctx: BuilderContext): string {
  if (rules.rules.length === 0) return "todos os contatos";
  const joiner = rules.combinator === "and" ? " e " : " ou ";
  return rules.rules.map((r) => describeRule(r, ctx)).join(joiner);
}

/** Zod is the judge; this only reads its verdict as a boolean. */
export function rulesValid(rules: unknown): rules is SegmentRules {
  return SegmentRules.safeParse(rules).success;
}

function fmtDay(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
