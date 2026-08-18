import { describe, it, expect } from "vitest";
import { matches } from "../../server/trigger-dispatch";
import {
  allowsMedia,
  allowsPattern,
  describeTrigger,
  findConflict,
  normalizeDraft,
  requiresPattern,
} from "../trigger-rules";

/**
 * Guards the two decisions the trigger UI delegates to this module: what a
 * trigger is allowed to be, and whether it can coexist with what exists.
 *
 * The load-bearing invariant is at the bottom: a pattern stored through
 * `normalizeDraft` must still fire through the dispatcher's `matches`. These
 * are two different functions in two different layers, and a divergence
 * between them is invisible until real DMs stop being answered.
 */

const row = (over: Partial<{
  id: string;
  kind: string;
  pattern: string | null;
  match: string;
  mediaId: string | null;
  flow: { name: string };
}> = {}) => ({
  id: "t1",
  kind: "KEYWORD",
  pattern: "preco",
  match: "CONTAINS",
  mediaId: null,
  flow: { name: "Fluxo A" },
  ...over,
});

describe("shape by kind", () => {
  it("requires a pattern only where one can be matched", () => {
    expect(requiresPattern("KEYWORD")).toBe(true);
    expect(requiresPattern("COMMENT")).toBe(true);
    expect(requiresPattern("STORY_REPLY")).toBe(false);
    expect(requiresPattern("STORY_MENTION")).toBe(false);
    expect(requiresPattern("DEFAULT")).toBe(false);
  });

  it("allows a post to be chosen only for comment triggers", () => {
    expect(allowsMedia("COMMENT")).toBe(true);
    expect(allowsMedia("KEYWORD")).toBe(false);
    expect(allowsMedia("STORY_REPLY")).toBe(false);
  });

  it("keeps no pattern on a kind that has no text to match", () => {
    expect(allowsPattern("STORY_MENTION")).toBe(false);
    const out = normalizeDraft({ kind: "STORY_MENTION", pattern: "ignorado" });
    expect(out.ok && out.draft.pattern).toBeNull();
  });

  it("drops a mediaId on a kind that cannot be scoped to a post", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "oi", mediaId: "179000" });
    expect(out.ok && out.draft.mediaId).toBeNull();
  });

  it("keeps the mediaId on a comment trigger", () => {
    const out = normalizeDraft({ kind: "COMMENT", pattern: "quero", mediaId: "179000" });
    expect(out.ok && out.draft.mediaId).toBe("179000");
  });
});

describe("normalizeDraft", () => {
  it("stores the folded form of a pattern", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "  ORÇAMENTO!!! " });
    expect(out.ok && out.draft.pattern).toBe("orcamento");
  });

  it("leaves a regex verbatim so its accents keep meaning", () => {
    const out = normalizeDraft({
      kind: "KEYWORD",
      pattern: "^orçamento$",
      match: "REGEX",
    });
    expect(out.ok && out.draft.pattern).toBe("^orçamento$");
  });

  it("rejects an invalid regex as a value, not an exception", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "([", match: "REGEX" });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/regular/i);
  });

  it("rejects a required pattern that is missing or whitespace", () => {
    expect(normalizeDraft({ kind: "KEYWORD", pattern: "   " }).ok).toBe(false);
    expect(normalizeDraft({ kind: "COMMENT" }).ok).toBe(false);
  });

  it("rejects a pattern that normalization empties out", () => {
    // Only emoji and punctuation: nothing survives folding, so this could
    // never match any message.
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "🔥🔥!!!" });
    expect(out.ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(normalizeDraft({ kind: "SOMETHING_ELSE" }).ok).toBe(false);
  });

  it("defaults to CONTAINS when no match mode is given", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "oi" });
    expect(out.ok && out.draft.match).toBe("CONTAINS");
  });
});

describe("findConflict", () => {
  const draft = (over = {}) => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "preço", ...over });
    if (!out.ok) throw new Error(out.error);
    return out.draft;
  };

  it("catches a duplicate written with different accents and punctuation", () => {
    expect(findConflict(draft(), [row({ pattern: "preco" })])).not.toBeNull();
  });

  it("does not collide with a different kind", () => {
    const existing = [row({ kind: "COMMENT", pattern: "preco" })];
    expect(findConflict(draft(), existing)).toBeNull();
  });

  it("ignores the trigger being edited", () => {
    const existing = [row({ id: "t1", pattern: "preco" })];
    expect(findConflict(draft(), existing, "t1")).toBeNull();
    expect(findConflict(draft(), existing, "other")).not.toBeNull();
  });

  it("treats the same word on two posts as two distinct comment triggers", () => {
    const onPostA = draft({ kind: "COMMENT", mediaId: "A" });
    const existing = [row({ kind: "COMMENT", pattern: "preco", mediaId: "B" })];
    expect(findConflict(onPostA, existing)).toBeNull();
  });

  it("treats a post-specific trigger as distinct from the catch-all", () => {
    const catchAll = draft({ kind: "COMMENT" });
    const existing = [row({ kind: "COMMENT", pattern: "preco", mediaId: "A" })];
    expect(findConflict(catchAll, existing)).toBeNull();
  });

  it("collides on the same post with the same word", () => {
    const onPostA = draft({ kind: "COMMENT", mediaId: "A" });
    const existing = [row({ kind: "COMMENT", pattern: "preco", mediaId: "A" })];
    expect(findConflict(onPostA, existing)).not.toBeNull();
  });

  it("collides on kind alone for a patternless kind", () => {
    const out = normalizeDraft({ kind: "DEFAULT" });
    if (!out.ok) throw new Error(out.error);
    const existing = [row({ kind: "DEFAULT", pattern: null })];
    expect(findConflict(out.draft, existing)).not.toBeNull();
  });

  it("treats EXACT and CONTAINS over the same word as the same rule", () => {
    // Only one of them can ever answer — whichever has priority — so the
    // second is dead configuration, not a refinement.
    const exact = draft({ match: "EXACT" });
    const existing = [row({ pattern: "preco", match: "CONTAINS" })];
    expect(findConflict(exact, existing)).not.toBeNull();
  });

  it("keeps two different regexes apart", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "^oi", match: "REGEX" });
    if (!out.ok) throw new Error(out.error);
    const existing = [row({ pattern: "^ola", match: "REGEX" })];
    expect(findConflict(out.draft, existing)).toBeNull();
  });
});

describe("a saved pattern still fires through the dispatcher", () => {
  // The invariant that ties this module to server/trigger-dispatch.ts.
  const cases: Array<[string, string]> = [
    ["ORÇAMENTO!!!", "qual o orçamento disso?"],
    ["preço", "me manda o PRECO por favor"],
    ["quero", "quero!!! 🔥"],
    ["tudo bem", "oi, tudo bem?"],
  ];

  for (const [typed, incoming] of cases) {
    it(`"${typed}" matches "${incoming}"`, () => {
      const out = normalizeDraft({ kind: "KEYWORD", pattern: typed });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(matches({ pattern: out.draft.pattern, match: out.draft.match }, incoming)).toBe(
        true,
      );
    });
  }

  it("still respects word boundaries after being stored", () => {
    const out = normalizeDraft({ kind: "KEYWORD", pattern: "oi" });
    if (!out.ok) return;
    expect(matches({ pattern: out.draft.pattern, match: out.draft.match }, "que coisa")).toBe(
      false,
    );
  });
});

describe("describeTrigger", () => {
  it("names the kind and the word the way the list shows it", () => {
    expect(
      describeTrigger({ kind: "COMMENT", pattern: "quero", match: "CONTAINS", mediaId: null }),
    ).toBe('Comentário na publicação ou Reel · contém "quero"');
  });

  it("names only the kind when there is no pattern", () => {
    expect(
      describeTrigger({ kind: "STORY_MENTION", pattern: null, match: "CONTAINS", mediaId: null }),
    ).toBe("Menção no story");
  });
});
