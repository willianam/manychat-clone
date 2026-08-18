"use client";

import { useEffect, useState } from "react";
import type { IgMedia } from "../lib/ig-media";
import { mediaLabel } from "../lib/ig-media";
import { loadMedia } from "../app/gatilhos/actions";

/**
 * Choose which publication a comment trigger watches.
 *
 * "Qualquer publicação" is a first-class choice, not an empty state: most
 * comment automations are meant to run on everything, and the dispatcher
 * already treats a post-specific trigger as beating the catch-all. It is
 * listed first and selected by default for exactly that reason.
 *
 * The list is fetched once per mount through a server action (the IG token
 * stays on the server) and is cached upstream for five minutes, so opening
 * the picker on ten triggers costs one API call. "Atualizar" is the escape
 * hatch for the one case the TTL gets wrong — the owner just posted.
 */

/** Module-scoped so remounting the picker does not re-hit the server action. */
let sessionCache: IgMedia[] | null = null;

export function MediaPicker({
  value,
  onChange,
}: {
  /** Selected media id, or null for "qualquer publicação". */
  value: string | null;
  onChange: (mediaId: string | null) => void;
}) {
  const [media, setMedia] = useState<IgMedia[]>(sessionCache ?? []);
  const [loading, setLoading] = useState(sessionCache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionCache !== null) return;
    let alive = true;
    setLoading(true);
    loadMedia()
      .then((r) => {
        if (!alive) return;
        sessionCache = r.media;
        setMedia(r.media);
        setError(r.error);
      })
      .catch(() => alive && setError("Não foi possível carregar as publicações."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await loadMedia(true);
      sessionCache = r.media;
      setMedia(r.media);
      setError(r.error);
    } catch {
      setError("Não foi possível carregar as publicações.");
    } finally {
      setLoading(false);
    }
  };

  // A trigger saved against a post that has since been deleted must still
  // show what it points at, rather than silently reading as "qualquer".
  const known = media.some((m) => m.id === value);

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Publicação
        </label>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-[11px] text-indigo-600 hover:underline disabled:opacity-40"
        >
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {error && (
        <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {error} Você ainda pode usar &quot;qualquer publicação&quot;.
        </p>
      )}

      <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${
            value === null ? "bg-emerald-50 ring-1 ring-emerald-300" : "hover:bg-neutral-50"
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-100 text-base">
            ∗
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-medium">Qualquer publicação</span>
            <span className="block text-[11px] text-neutral-500">
              Vale para todos os posts e Reels
            </span>
          </span>
        </button>

        {value !== null && !known && !loading && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-2 py-2 ring-1 ring-emerald-300">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-200 text-[10px] text-neutral-500">
              ?
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">Publicação selecionada</span>
              <span className="block truncate text-[11px] text-neutral-500">
                id {value} — não está na lista atual
              </span>
            </span>
          </div>
        )}

        {media.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${
              value === m.id ? "bg-emerald-50 ring-1 ring-emerald-300" : "hover:bg-neutral-50"
            }`}
          >
            <Thumb media={m} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">{mediaLabel(m)}</span>
              <span className="block text-[11px] text-neutral-500">
                {typeLabel(m)}
                {m.timestamp ? ` · ${shortDate(m.timestamp)}` : ""}
              </span>
            </span>
          </button>
        ))}

        {!loading && media.length === 0 && !error && (
          <p className="px-2 py-3 text-center text-[11px] text-neutral-500">
            Nenhuma publicação encontrada na conta.
          </p>
        )}
      </div>
    </div>
  );
}

function Thumb({ media }: { media: IgMedia }) {
  if (!media.thumbnailUrl) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-100 text-[9px] text-neutral-400">
        sem capa
      </span>
    );
  }
  return (
    // A remote IG CDN url with a signed expiry: next/image would try to
    // optimize and cache it, which fails once the signature rolls over.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={media.thumbnailUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded object-cover"
      loading="lazy"
    />
  );
}

function typeLabel(m: IgMedia): string {
  switch (m.mediaType) {
    case "VIDEO":
      return "Reel / vídeo";
    case "CAROUSEL_ALBUM":
      return "Carrossel";
    case "IMAGE":
      return "Foto";
    default:
      return "Publicação";
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
