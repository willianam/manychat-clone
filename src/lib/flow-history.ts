/**
 * Undo history for the editor, kept as plain data so it can be tested
 * without a canvas.
 *
 * The stack holds SNAPSHOTS OF THE STATE BEFORE EACH CHANGE, not diffs: a
 * graph is a few kilobytes, and restoring a snapshot cannot fail the way
 * replaying an inverse edit against a moved node can.
 *
 * Text edits arrive one keystroke at a time. Recording every one would make
 * ⌘Z step back a character; instead a change that carries the same `key`
 * as the previous one within `COALESCE_MS` is folded into it — the snapshot
 * taken before the first keystroke already holds the text the user wants
 * back.
 */

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export type History<T> = {
  past: T[];
  future: T[];
  /** Coalescing key of the last recorded change, and when it happened. */
  lastKey: string | null;
  lastAt: number;
};

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], lastKey: null, lastAt: 0 };
}

/**
 * Record `before` as the state a future undo returns to. Clears the redo
 * stack: a new change after an undo forks the timeline.
 */
export function record<T>(
  h: History<T>,
  before: T,
  key: string | null = null,
  now: number = Date.now(),
): History<T> {
  const coalesce = key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS;
  if (coalesce) return { ...h, future: [], lastAt: now };
  return {
    past: [...h.past, before].slice(-HISTORY_LIMIT),
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

/** Step back. Returns the state to restore, or null when there is none. */
export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = h.past[h.past.length - 1];
  if (state === undefined) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [current, ...h.future],
      lastKey: null,
      lastAt: 0,
    },
    state,
  };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = h.future[0];
  if (state === undefined) return null;
  return {
    history: { past: [...h.past, current], future: h.future.slice(1), lastKey: null, lastAt: 0 },
    state,
  };
}
