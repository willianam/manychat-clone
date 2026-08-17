import { describe, it, expect } from "vitest";
import { normalizeText, normalizeForGrouping, containsWord } from "../text-normalize";
import { matches } from "../../server/trigger-dispatch";

/** Terse builder for the two fields `matches` actually reads. */
const trigger = (pattern: string, match: "EXACT" | "CONTAINS" | "REGEX" = "CONTAINS") =>
  ({ pattern, match }) as const;

describe("normalizeText", () => {
  it("folds Portuguese accents to their base letters", () => {
    expect(normalizeText("orçamento")).toBe("orcamento");
    expect(normalizeText("informação")).toBe("informacao");
    expect(normalizeText("é")).toBe("e");
    expect(normalizeText("PREÇO")).toBe("preco");
  });

  it("lowercases", () => {
    expect(normalizeText("Orçamento")).toBe("orcamento");
  });

  it("strips punctuation from the ends", () => {
    expect(normalizeText("OI!!!")).toBe("oi");
    expect(normalizeText("...oi...")).toBe("oi");
    expect(normalizeText("quanto custa?")).toBe("quanto custa");
  });

  it("removes emoji without gluing words together", () => {
    expect(normalizeText("oi 👋")).toBe("oi");
    expect(normalizeText("👋 oi")).toBe("oi");
    // The emoji becomes a separator, so two words stay two words.
    expect(normalizeText("oi👋tudo")).toBe("oi tudo");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeText("quero    saber   mais")).toBe("quero saber mais");
    expect(normalizeText("oi\n\ttudo")).toBe("oi tudo");
  });

  it("is idempotent", () => {
    const once = normalizeText("  Orçamento!! 👋 ");
    expect(normalizeText(once)).toBe(once);
  });

  it("leaves an empty or emoji-only string empty", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
    expect(normalizeText("👋")).toBe("");
  });

  it("keeps digits and interior meaning", () => {
    expect(normalizeText("plano 2")).toBe("plano 2");
  });
});

describe("normalizeForGrouping", () => {
  it("folds punctuation inside the phrase so variants group together", () => {
    expect(normalizeForGrouping("oi!!! tudo bem?")).toBe("oi tudo bem");
    expect(normalizeForGrouping("Oi, tudo bem")).toBe("oi tudo bem");
  });

  it("groups the accent and no-accent spellings of a price question", () => {
    expect(normalizeForGrouping("Preço?")).toBe(normalizeForGrouping("preco"));
  });
});

describe("containsWord", () => {
  it("matches whole words only", () => {
    expect(containsWord("oi tudo bem", "oi")).toBe(true);
    expect(containsWord("coisa linda", "oi")).toBe(false);
  });

  it("matches at either end of the string", () => {
    expect(containsWord("bem oi", "oi")).toBe(true);
    expect(containsWord("oi", "oi")).toBe(true);
  });

  it("handles multi-word needles", () => {
    expect(containsWord("quero saber o preco hoje", "o preco")).toBe(true);
  });
});

describe("matches — the acceptance cases", () => {
  it('"Orçamento" fires a trigger written "orcamento"', () => {
    expect(matches(trigger("orcamento"), "Orçamento")).toBe(true);
  });

  it("also fires the other way round: accented pattern, plain text", () => {
    expect(matches(trigger("orçamento"), "quero um orcamento")).toBe(true);
  });

  it('"OI!!!" fires a trigger written "oi"', () => {
    expect(matches(trigger("oi"), "OI!!!")).toBe(true);
  });

  it('"oi 👋" fires a trigger written "oi"', () => {
    expect(matches(trigger("oi"), "oi 👋")).toBe(true);
  });

  it('"coisa" does NOT fire a trigger written "oi"', () => {
    expect(matches(trigger("oi"), "coisa")).toBe(false);
  });

  it("does not fire inside a longer word in either direction", () => {
    expect(matches(trigger("oi"), "heroi")).toBe(false);
    expect(matches(trigger("preco"), "precoce")).toBe(false);
  });
});

describe("matches — EXACT", () => {
  it("ignores accents, case and edge punctuation", () => {
    expect(matches(trigger("orcamento", "EXACT"), "  Orçamento!  ")).toBe(true);
    expect(matches(trigger("oi", "EXACT"), "oi 👋")).toBe(true);
  });

  it("still requires the whole message to be the keyword", () => {
    expect(matches(trigger("oi", "EXACT"), "oi tudo bem")).toBe(false);
  });
});

describe("matches — REGEX", () => {
  it("runs against the raw text, uncorrupted by normalization", () => {
    expect(matches(trigger("or.amento", "REGEX"), "orçamento")).toBe(true);
    expect(matches(trigger("^oi$", "REGEX"), "oi")).toBe(true);
    expect(matches(trigger("^oi$", "REGEX"), "oi tudo")).toBe(false);
  });

  it("returns false for an invalid pattern rather than throwing", () => {
    expect(matches(trigger("([unclosed", "REGEX"), "qualquer coisa")).toBe(false);
  });
});

describe("matches — degenerate patterns", () => {
  it("never fires on an empty or emoji-only pattern", () => {
    expect(matches(trigger(""), "oi")).toBe(false);
    expect(matches(trigger("👋"), "oi 👋")).toBe(false);
  });
});
