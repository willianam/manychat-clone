import type { NextRequest } from "next/server";
import { db } from "../../../server/db";
import { exportContactsCsv } from "../../../server/contacts-csv";
import { contactsWhere } from "../../../server/contacts-list";
import { hasFilters, parseContactQuery, type RawSearchParams } from "../../../lib/contact-query";

export const dynamic = "force-dynamic";

/**
 * CSV download of the contact list. Takes the same query string as
 * /contacts, so "export what I am looking at" is the list's own URL with
 * `/export` in the path. Behind the middleware like every panel route.
 */
export async function GET(req: NextRequest) {
  const raw: RawSearchParams = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const query = parseContactQuery(raw);
  const where = hasFilters(query) ? await contactsWhere(db, query) : undefined;
  const csv = await exportContactsCsv(db, { where });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contatos-${stamp}.csv"`,
    },
  });
}
