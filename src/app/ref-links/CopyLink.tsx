"use client";

import { useState } from "react";

/**
 * The link plus a one-tap copy.
 *
 * A ref link is only useful pasted somewhere else, so copying is the primary
 * action on this row — showing the URL without a copy button means every use
 * starts with a careful manual selection.
 */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard needs a secure context; the url is on screen either way.
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-700">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
