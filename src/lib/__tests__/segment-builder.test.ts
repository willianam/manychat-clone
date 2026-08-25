import { describe, expect, it } from "vitest";
import {
  OPS,
  RULE_KINDS,
  defaultRule,
  describeRule,
  describeRules,
  rulesValid,
  valueInput,
  withOp,
} from "../segment-builder";
import { SegmentRule } from "../segment-rules";

const ctx = {
  tags: [{ id: "t-vip", name: "vip" }],
  fields: [{ key: "total", label: "Total gasto" }],
};
const TODAY = new Date("2026-08-25T15:00:00Z");

describe("segment builder vocabulary", () => {
  it("offers every kind the schema knows, and every operator it accepts", () => {
    const kinds = SegmentRule.options.map((o) => o.shape.kind.value);
    expect(RULE_KINDS.map((k) => k.kind).sort()).toEqual([...kinds].sort());
    for (const k of RULE_KINDS) {
      for (const o of OPS[k.kind]) {
        expect(rulesValid({ rules: [{ ...defaultRule(k.kind, ctx, TODAY), op: o.op }] })).toBe(
          true,
        );
      }
    }
  });

  it("builds a valid default rule for every kind when tags and fields exist", () => {
    for (const k of RULE_KINDS) {
      expect(rulesValid({ rules: [defaultRule(k.kind, ctx, TODAY)] })).toBe(true);
    }
    expect(defaultRule("createdAt", ctx, TODAY)).toEqual({
      kind: "createdAt",
      op: "after",
      value: "2026-08-25",
    });
  });

  it("a tag rule without tags is incomplete until a tag is picked", () => {
    expect(rulesValid({ rules: [defaultRule("tag", { tags: [], fields: [] })] })).toBe(false);
  });

  it("tells the builder which value cell to render", () => {
    expect(valueInput({ kind: "tag", op: "has", value: "t" })).toBe("tag");
    expect(valueInput({ kind: "field", key: "a", op: "exists" })).toBe("none");
    expect(valueInput({ kind: "field", key: "a", op: "gt", value: "1" })).toBe("text");
    expect(valueInput({ kind: "field", key: "a", op: "before", value: "2026-01-01" })).toBe("date");
    expect(valueInput({ kind: "lastInbound", op: "never" })).toBe("none");
    expect(valueInput({ kind: "subscribed", op: "is", value: true })).toBe("boolean");
    expect(valueInput({ kind: "window", op: "out" })).toBe("none");
  });

  it("withOp drops a value the new operator does not take and seeds a date when it needs one", () => {
    const a = withOp({ kind: "field", key: "a", op: "equals", value: "x" }, "exists");
    expect(a).toEqual({ kind: "field", key: "a", op: "exists" });
    const b = withOp({ kind: "lastInbound", op: "never" }, "after");
    expect(
      b.kind === "lastInbound" && b.op === "after" && /^\d{4}-\d{2}-\d{2}$/.test(b.value ?? ""),
    ).toBe(true);
  });

  it("describes rules in Portuguese, resolving tag and field names", () => {
    expect(describeRule({ kind: "tag", op: "has", value: "t-vip" }, ctx)).toBe(
      'tem a etiqueta "vip"',
    );
    expect(describeRule({ kind: "field", key: "total", op: "gt", value: "100" }, ctx)).toBe(
      'campo "Total gasto" é maior que 100',
    );
    expect(describeRule({ kind: "field", key: "total", op: "missing" }, ctx)).toBe(
      'campo "Total gasto" está vazio',
    );
    expect(describeRule({ kind: "lastInbound", op: "before", value: "2026-08-01" }, ctx)).toBe(
      "última interação antes de 01/08/2026",
    );
    expect(describeRule({ kind: "window", op: "in" }, ctx)).toBe("dentro da janela de 24h");
    expect(describeRule({ kind: "subscribed", op: "is", value: false }, ctx)).toBe("descadastrado");
    expect(describeRule({ kind: "source", op: "startsWith", value: "ref:" }, ctx)).toBe(
      'origem começa com "ref:"',
    );
  });

  it("joins the group with e / ou, and reads an empty group as everyone", () => {
    expect(describeRules({ combinator: "and", rules: [] }, ctx)).toBe("todos os contatos");
    expect(
      describeRules(
        {
          combinator: "or",
          rules: [
            { kind: "window", op: "in" },
            { kind: "subscribed", op: "is", value: true },
          ],
        },
        ctx,
      ),
    ).toBe("dentro da janela de 24h ou inscrito");
  });
});
