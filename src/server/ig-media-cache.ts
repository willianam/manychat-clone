/**
 * The account's published media, fetched from Meta and cached in memory.
 *
 * The post selector needs this list every time someone opens a comment
 * trigger. Meta's rate limits are per-app and shared with the send path that
 * actually answers people, so re-fetching on every render would spend the
 * budget that replies depend on. The list also changes at the speed of
 * someone posting to Instagram — minutes at best — so a short TTL loses
 * nothing real.
 *
 * The cache is module-scoped, which means per server instance. That is the
 * right scope here: it is a read-through cache of somebody else's data with
 * no correctness requirement, so instances disagreeing for a few minutes is
 * invisible. `refresh: true` (the "Atualizar" button) exists for the one case
 * where the owner knows better than the TTL — they just posted.
 */

import { MEDIA_FIELDS, parseMediaList, type IgMedia } from "../lib/ig-media";
import { db } from "./db";
import { getAccessToken } from "./token-refresh";

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v26.0";
const BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const SELF = process.env.IG_USER_ID ?? "me";

/** How long a fetched list stays good. */
const TTL_MS = 5 * 60 * 1000;

/** How many posts to offer. Beyond this the picker stops being a picker. */
const LIMIT = 50;

type Entry = { at: number; media: IgMedia[] };

let cache: Entry | null = null;
/** In-flight request, so ten concurrent renders make one API call. */
let inflight: Promise<IgMedia[]> | null = null;

export type MediaListResult = {
  media: IgMedia[];
  /** Null on success; a pt-BR sentence the UI can show on failure. */
  error: string | null;
  /** When the list we are showing was fetched. Null if never. */
  fetchedAt: Date | null;
};

/**
 * The media list, from cache when fresh.
 *
 * Never throws. A trigger form must still open — and still let the owner pick
 * "qualquer publicação" — when Meta is down or the token has expired; failing
 * the whole page over a thumbnail strip would be worse than showing none.
 * On failure a stale cached list is returned rather than an empty one: an
 * old list of the owner's real posts is more useful than nothing.
 */
export async function listMedia(
  opts: { refresh?: boolean } = {},
): Promise<MediaListResult> {
  const now = Date.now();

  if (!opts.refresh && cache && now - cache.at < TTL_MS) {
    return { media: cache.media, error: null, fetchedAt: new Date(cache.at) };
  }

  if (opts.refresh) {
    cache = null;
    inflight = null;
  }

  try {
    const media = await (inflight ??= fetchMedia().finally(() => {
      inflight = null;
    }));
    cache = { at: Date.now(), media };
    return { media, error: null, fetchedAt: new Date(cache.at) };
  } catch (err) {
    return {
      media: cache?.media ?? [],
      error: describe(err),
      fetchedAt: cache ? new Date(cache.at) : null,
    };
  }
}

/** Drop the cache. Called after anything that could change the list. */
export function invalidateMediaCache(): void {
  cache = null;
  inflight = null;
}

async function fetchMedia(): Promise<IgMedia[]> {
  const token = await getAccessToken(db).catch(() => null);
  if (!token) throw new Error("MISSING_TOKEN");

  const url = `${BASE}/${SELF}/media?fields=${MEDIA_FIELDS}&limit=${LIMIT}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // This data is ours to cache; Next's fetch cache would add a second,
    // longer-lived layer we cannot invalidate from the "Atualizar" button.
    cache: "no-store",
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
        ? body.error.message
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return parseMediaList(body);
}

function describe(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === "MISSING_TOKEN") {
    return "IG_ACCESS_TOKEN não está configurado — não dá para listar as publicações.";
  }
  return `Não foi possível carregar as publicações do Instagram: ${raw}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
