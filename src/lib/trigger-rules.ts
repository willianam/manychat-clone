/**
 * Trigger rules shared by the UI and the server actions.
 *
 * The dispatcher (server/trigger-dispatch.ts) is the authority on *matching*.
 * This module is the authority on what a trigger is even allowed to BE, so
 * the form and the action agree on the same answer instead of each inventing
 * its own validation.
 *
 * Two ideas carry it:
 *
 *  1. **Shape by kind.** Only KEYWORD and COMMENT read a pattern; STORY_REPLY
 *     may have one (a keyword inside a story reply) but does not need one;
 *     STORY_MENTION, REF and DEFAULT have no text to match against at all.
 *     Only COMMENT can be narrowed to a single post.
 *
 *  2. **Duplicates are decided on the normalized form.** Matching folds
 *     accents and punctuation on both sides, so "Orçamento!" and "orcamento"
 *     are the same trigger even though the raw strings differ. Comparing raw
 *     strings would let the owner create two triggers only one of which can
 *     ever fire.
 */

import { normalizeText } from "./text-normalize";

export type TriggerKindName =
  "KEYWORD" | "COMMENT" | "STORY_REPLY" | "STORY_MENTION" | "REF" | "DEFAULT";

export type MatchModeName = "EXACT" | "CONTAINS" | "REGEX";

export const TRIGGER_KINDS: TriggerKindName[] = [
  "KEYWORD",
  "COMMENT",
  "STORY_REPLY",
  "STORY_MENTION",
  "REF",
  "DEFAULT",
];

/** How each kind is described in the interface (pt-BR). */
export const KIND_LABEL: Record<TriggerKindName, string> = {
  KEYWORD: "Palavra-chave no direct",
  COMMENT: "Comentário na publicação ou Reel",
  STORY_REPLY: "Resposta ao story",
  STORY_MENTION: "Menção no story",
  REF: "Link rastreável (ig.me)",
  DEFAULT: "Qualquer outra mensagem",
};

/** One line of explanation under the kind, for the picker. */
export const KIND_HINT: Record<TriggerKindName, string> = {
  KEYWORD: "Alguém manda essa palavra no direct",
  COMMENT: "Alguém comenta a palavra numa publicação sua",
  STORY_REPLY: "Alguém responde um story seu",
  STORY_MENTION: "Alguém marca você no story dele",
  REF: "Alguém abre o direct por um link com ?ref=",
  DEFAULT: "Nada casou — este é o fluxo de fallback",
};

export const MATCH_LABEL: Record<MatchModeName, string> = {
  CONTAINS: "Contém a palavra",
  EXACT: "É exatamente igual",
  REGEX: "Expressão regular",
};

/** Kinds whose pattern is required — without it they can never fire. */
const PATTERN_REQUIRED: TriggerKindName[] = ["KEYWORD", "COMMENT"];

/** Kinds that accept a pattern at all. */
const PATTERN_ALLOWED: TriggerKindName[] = ["KEYWORD", "COMMENT", "STORY_REPLY"];

export function requiresPattern(kind: TriggerKindName): boolean {
  return PATTERN_REQUIRED.includes(kind);
}

export function allowsPattern(kind: TriggerKindName): boolean {
  return PATTERN_ALLOWED.includes(kind);
}

/** Only a comment trigger can be narrowed to one publication. */
export function allowsMedia(kind: TriggerKindName): boolean {
  return kind === "COMMENT";
}

export function isTriggerKind(value: unknown): value is TriggerKindName {
  return typeof value === "string" && (TRIGGER_KINDS as string[]).includes(value);
}

export function isMatchMode(value: unknown): value is MatchModeName {
  return value === "EXACT" || value === "CONTAINS" || value === "REGEX";
}

export type TriggerDraft = {
  kind: TriggerKindName;
  pattern: string | null;
  match: MatchModeName;
  mediaId: string | null;
};

/**
 * Coerce raw form input into the shape the database should hold.
 *
 * Returns the failure as a value — the caller renders it, and a bad regex or
 * a missing keyword is user error, not a server crash.
 *
 * The pattern is stored NORMALIZED. Matching normalizes both sides anyway,
 * so storing the folded form costs nothing at match time and makes the
 * trigger list readable and comparable. REGEX is the exception: the owner
 * wrote that pattern against the literal message and folding accents out
 * from under it would silently change what it matches.
 */
export function normalizeDraft(input: {
  kind: unknown;
  pattern?: unknown;
  match?: unknown;
  mediaId?: unknown;
}): { ok: true; draft: TriggerDraft } | { ok: false; error: string } {
  if (!isTriggerKind(input.kind)) {
    return { ok: false, error: "Tipo de gatilho inválido." };
  }
  const kind = input.kind;

  const match: MatchModeName = isMatchMode(input.match) ? input.match : "CONTAINS";

  const rawPattern = String(input.pattern ?? "").trim();

  if (!allowsPattern(kind)) {
    // A kind with nothing to match against keeps no pattern: leaving one
    // behind would show a word in the list that has no effect on anything.
    return {
      ok: true,
      draft: { kind, pattern: null, match: "CONTAINS", mediaId: null },
    };
  }

  if (!rawPattern && requiresPattern(kind)) {
    return {
      ok: false,
      error:
        kind === "COMMENT"
          ? "Escreva a palavra que o comentário precisa ter."
          : "Escreva a palavra-chave do gatilho.",
    };
  }

  let pattern: string | null = null;
  if (rawPattern) {
    if (match === "REGEX") {
      try {
        new RegExp(rawPattern, "i");
      } catch {
        return { ok: false, error: "Expressão regular inválida." };
      }
      pattern = rawPattern.slice(0, 200);
    } else {
      const folded = normalizeText(rawPattern);
      if (!folded) {
        // Only emoji/punctuation: nothing survives normalization, so this
        // pattern could never match anything.
        return { ok: false, error: "Essa palavra-chave não tem texto para casar." };
      }
      pattern = folded.slice(0, 200);
    }
  }

  const mediaRaw = String(input.mediaId ?? "").trim();
  const mediaId = allowsMedia(kind) && mediaRaw ? mediaRaw.slice(0, 100) : null;

  return { ok: true, draft: { kind, pattern, match, mediaId } };
}

/**
 * Would this draft collide with a trigger that already exists?
 *
 * "Collide" means: the same kind, over the same scope, matching the same
 * text. Two such triggers are a coin flip at dispatch time — whichever has
 * the higher priority always wins and the other is dead configuration.
 *
 * Scope matters for COMMENT: "promo" on post A and "promo" on post B are
 * distinct triggers, and "promo" on any post is distinct from both (the
 * dispatcher deliberately lets a post-specific trigger beat the catch-all).
 *
 * Patternless kinds (STORY_MENTION, DEFAULT) collide on kind alone: the
 * dispatcher picks exactly one of them by priority, so a second is inert.
 */
export function findConflict<
  T extends {
    id: string;
    kind: string;
    pattern: string | null;
    match: string;
    mediaId: string | null;
  },
>(draft: TriggerDraft, existing: T[], ignoreId?: string): T | null {
  const target = comparableKey(draft);

  for (const t of existing) {
    if (ignoreId && t.id === ignoreId) continue;
    if (t.kind !== draft.kind) continue;

    const key = comparableKey({
      kind: t.kind as TriggerKindName,
      pattern: t.pattern,
      match: t.match as MatchModeName,
      mediaId: t.mediaId,
    });
    if (key === target) return t;
  }
  return null;
}

/**
 * The identity of a trigger for conflict purposes.
 *
 * A regex is compared verbatim (two different regexes are different rules
 * even if they overlap); everything else is compared folded, because that is
 * the form the dispatcher actually tests.
 */
function comparableKey(d: {
  kind: TriggerKindName;
  pattern: string | null;
  match: MatchModeName;
  mediaId: string | null;
}): string {
  const scope = allowsMedia(d.kind) ? (d.mediaId ?? "*") : "-";
  if (!allowsPattern(d.kind) || !d.pattern) return `${d.kind}|${scope}|`;
  const text = d.match === "REGEX" ? d.pattern : normalizeText(d.pattern);
  // EXACT and CONTAINS over the same word are treated as the same rule:
  // whichever has priority answers, the other never gets a turn.
  return `${d.kind}|${scope}|${d.match === "REGEX" ? "re:" : ""}${text}`;
}

/** Human summary of a trigger, used in lists and on the canvas card. */
export function describeTrigger(t: {
  kind: string;
  pattern: string | null;
  match: string;
  mediaId: string | null;
}): string {
  const kind = isTriggerKind(t.kind) ? KIND_LABEL[t.kind] : t.kind;
  if (!t.pattern) return kind;
  const mode = t.match === "EXACT" ? "=" : t.match === "REGEX" ? "regex" : "contém";
  return `${kind} · ${mode} "${t.pattern}"`;
}
