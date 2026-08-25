"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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
      toast.success("Link copiado.");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard needs a secure context; the url is on screen either way.
      setCopied(false);
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs text-neutral-700">
        {url}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copiado!" : "Copiar"}
      </Button>
    </div>
  );
}
