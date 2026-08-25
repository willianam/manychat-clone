import { useSyncExternalStore } from "react";

/**
 * "There are unsaved changes" as one app-wide flag.
 *
 * The editor sets it; navigation asks it. A module-level store rather than
 * context because the two sides live in different trees (the editor page
 * and the shell's sidebar) and the flag has exactly one meaning.
 */

let unsaved = false;
const listeners = new Set<() => void>();

export function setUnsaved(value: boolean): void {
  if (unsaved === value) return;
  unsaved = value;
  for (const l of listeners) l();
}

export function isUnsaved(): boolean {
  return unsaved;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useUnsaved(): boolean {
  return useSyncExternalStore(subscribe, isUnsaved, () => false);
}
