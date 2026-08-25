/**
 * The contact list's URL state.
 *
 * Every filter, the sort and the page live in the query string, so a view is
 * a link: the owner can bookmark "unsubscribed contacts from a ref link" and
 * a segment's "ver contatos" is just `/contacts?segment=<id>`. This module
 * is pure — parse in, serialize out — and the server half (contacts-list.ts)
 * turns the parsed query into a Prisma where.
 */

export const CONTACTS_PAGE_SIZE = 50;

export type ContactSort = "lastInbound" | "name" | "createdAt";
export type SortDir = "asc" | "desc";

export type ContactQuery = {
  q: string;
  tags: string[];
  subscribed?: boolean;
  window?: "in" | "out";
  source?: string;
  segment?: string;
  sort: ContactSort;
  dir: SortDir;
  page: number;
};

export const DEFAULT_QUERY: ContactQuery = {
  q: "",
  tags: [],
  sort: "lastInbound",
  dir: "desc",
  page: 1,
};

const SORTS: ContactSort[] = ["lastInbound", "name", "createdAt"];

/** Next hands a page `searchParams` as string | string[] | undefined per key. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function many(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).filter(Boolean);
}

export function parseContactQuery(raw: RawSearchParams): ContactQuery {
  const sortRaw = one(raw.sort);
  const sort = SORTS.includes(sortRaw as ContactSort) ? (sortRaw as ContactSort) : "lastInbound";
  const dirRaw = one(raw.dir);
  const dir: SortDir =
    dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "name" ? "asc" : "desc";
  const pageRaw = Number(one(raw.page));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sub = one(raw.subscribed);
  const win = one(raw.window);

  return {
    q: (one(raw.q) ?? "").trim().slice(0, 100),
    tags: many(raw.tag),
    subscribed: sub === "true" ? true : sub === "false" ? false : undefined,
    window: win === "in" || win === "out" ? win : undefined,
    source: one(raw.source)?.trim() || undefined,
    segment: one(raw.segment)?.trim() || undefined,
    sort,
    dir,
    page,
  };
}

/** Only what differs from the default goes into the URL, so a clean view has a clean address. */
export function serializeContactQuery(q: Partial<ContactQuery>): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  for (const t of q.tags ?? []) p.append("tag", t);
  if (q.subscribed !== undefined) p.set("subscribed", String(q.subscribed));
  if (q.window) p.set("window", q.window);
  if (q.source) p.set("source", q.source);
  if (q.segment) p.set("segment", q.segment);
  const sort = q.sort ?? DEFAULT_QUERY.sort;
  if (sort !== DEFAULT_QUERY.sort) p.set("sort", sort);
  const defaultDir: SortDir = sort === "name" ? "asc" : "desc";
  if (q.dir && q.dir !== defaultDir) p.set("dir", q.dir);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The same query with one part changed; page resets unless it is the part being changed. */
export function withQuery(base: ContactQuery, patch: Partial<ContactQuery>): ContactQuery {
  return { ...base, page: 1, ...patch };
}

export function hasFilters(q: ContactQuery): boolean {
  return Boolean(
    q.q || q.tags.length || q.subscribed !== undefined || q.window || q.source || q.segment,
  );
}
