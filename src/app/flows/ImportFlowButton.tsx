"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importFlow } from "./actions";

/**
 * "Importar" — reads a .json off disk and hands the text to the server action.
 *
 * The file is read in the browser rather than posted as multipart because the
 * validation that matters is textual: we want to show the user the exact
 * reason a file was rejected, and a failed import should leave them on the
 * same page with the message, not on an error screen.
 */
export function ImportFlowButton() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    const text = await file.text();
    start(async () => {
      const res = await importFlow(text);
      if (res.ok) {
        router.push(`/flows/${res.id}`);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="relative">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          // Reset so picking the same file twice still fires a change event.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className="whitespace-nowrap rounded-lg border px-4 py-1.5 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50"
      >
        {pending ? "Importando…" : "Importar"}
      </button>

      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 shadow-sm"
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="mt-1.5 block text-[11px] font-medium underline"
          >
            fechar
          </button>
        </div>
      )}
    </div>
  );
}
