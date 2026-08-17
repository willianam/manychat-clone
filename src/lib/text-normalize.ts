/**
 * Text normalization for keyword matching.
 *
 * Portuguese breaks naive `toLowerCase().trim()` matching in three ways that
 * all show up constantly in real DMs:
 *
 * 1. Accents. People type "orcamento" as often as "orçamento", and phone
 *    keyboards autocorrect in both directions. A trigger written one way
 *    must fire for the other.
 * 2. Emoji and punctuation. "OI!!!" and "oi 👋" are the same greeting as
 *    "oi", but the raw strings differ.
 * 3. Repeated whitespace, from wrapped typing or copy/paste.
 *
 * The rule that makes this safe: BOTH sides — inbound text and the stored
 * pattern — go through the exact same function. Normalization that is only
 * applied to one side silently changes which triggers can ever match.
 *
 * What is deliberately preserved: interior punctuation that carries meaning
 * (`ola,tudo bem` keeps its comma so the word boundary still lands where a
 * reader would expect), and word boundaries themselves — the CONTAINS mode
 * still matches whole words, so "oi" does not fire inside "coisa".
 */

/**
 * Unicode ranges for emoji and pictographs. Kept explicit rather than using
 * `\p{Emoji}`, which also matches plain digits and `#`/`*` — characters that
 * are legitimate parts of a keyword.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2B00}-\u{2BFF}]/gu;

/** Punctuation trimmed from the ends of the string and of each word. */
const EDGE_PUNCT = /^[\s!¡?¿.,;:…"'`´^~*_\-–—()[\]{}<>/\\|@#$%&+=]+|[\s!¡?¿.,;:…"'`´^~*_\-–—()[\]{}<>/\\|@#$%&+=]+$/gu;

/**
 * Fold a string to its comparable form.
 *
 * NFD splits an accented character into base + combining mark, then the
 * combining-mark range is stripped, so "ç" becomes "c" and "ã" becomes "a".
 * Recomposing with NFC afterwards keeps the result a well-formed string for
 * anything downstream that inspects it.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics left behind by NFD
    .normalize("NFC")
    .toLowerCase()
    .replace(EMOJI, " ") // an emoji becomes a separator, not a deletion:
    //                      "oi👋tudo" must not collapse into "oitudo"
    .replace(/\s+/g, " ") // collapse repeated whitespace
    .replace(EDGE_PUNCT, "")
    .trim();
}

/**
 * Normalize and additionally strip punctuation hugging each word, so
 * "oi!!! tudo bem?" and "oi tudo bem" fold together. Used for the aggregation
 * key of unmatched messages, where the goal is grouping near-identical
 * phrasings rather than matching a stored pattern.
 */
export function normalizeForGrouping(input: string): string {
  return normalizeText(input)
    .split(" ")
    .map((w) => w.replace(EDGE_PUNCT, ""))
    .filter(Boolean)
    .join(" ");
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word containment over normalized text.
 *
 * `\b` is ASCII-only in JavaScript, which is exactly what we want *after*
 * normalization: accents are already folded to ASCII letters, so the
 * boundary lands correctly. Applying `\b` to un-normalized "orçamento"
 * would treat "ç" as a non-word character and split the word in two.
 */
export function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // A needle whose edges are non-word characters (e.g. "?!") can't use \b —
  // the boundary would never match. Fall back to plain substring search.
  const left = /^\w/.test(needle) ? "\\b" : "";
  const right = /\w$/.test(needle) ? "\\b" : "";
  return new RegExp(`${left}${escapeRegex(needle)}${right}`).test(haystack);
}
