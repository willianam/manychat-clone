import type { PrismaClient } from "@prisma/client";
import { parseCsvRecords, serializeCsv } from "../lib/csv";
import { addTagToContact, removeTagFromContact, setContactSubscribed } from "./contact-events";
import { saveContactField } from "./contact-fields";

/**
 * Contact export / import.
 *
 * Columns: igScopedId, username, name, tags, subscribed, createdAt, then one
 * column per registered custom field (field:<key>). Tags are joined with "|".
 *
 * Import only UPDATES. A contact is a person who messaged the account; the
 * only identifier Instagram will deliver to is the IGSID that arrives on
 * their first webhook, and no spreadsheet can supply it. Rows that match no
 * existing contact (by igScopedId, then by username) are reported as
 * skipped, never created.
 */

export const FIXED_COLUMNS = [
  "igScopedId",
  "username",
  "name",
  "tags",
  "subscribed",
  "createdAt",
] as const;
const FIELD_PREFIX = "field:";

export async function exportContactsCsv(db: PrismaClient): Promise<string> {
  const [fields, contacts] = await Promise.all([
    db.customField.findMany({ orderBy: { key: "asc" }, select: { key: true } }),
    db.contact.findMany({
      orderBy: { createdAt: "asc" },
      include: { tags: { include: { tag: { select: { name: true } } } }, fields: true },
    }),
  ]);
  const keys = fields.map((f) => f.key);

  const rows: string[][] = [[...FIXED_COLUMNS, ...keys.map((k) => FIELD_PREFIX + k)]];
  for (const c of contacts) {
    const byKey = new Map(c.fields.map((f) => [f.key, f.value]));
    rows.push([
      c.igScopedId,
      c.username ?? "",
      c.name ?? "",
      c.tags.map((t) => t.tag.name).join("|"),
      c.subscribed ? "true" : "false",
      c.createdAt.toISOString(),
      ...keys.map((k) => byKey.get(k) ?? ""),
    ]);
  }
  return serializeCsv(rows);
}

export type ImportReport = {
  updated: number;
  /** Rows with no matching contact, with the identifier that was tried. */
  skipped: string[];
};

const TRUE_WORDS = new Set(["true", "1", "sim", "yes", "y", "s"]);

/**
 * Apply a CSV to existing contacts. Blank cells leave the value alone; a
 * `tags` cell replaces the contact's tag set (so removing a tag is possible);
 * `subscribed` accepts true/false/sim/não. `createdAt` is ignored.
 */
export async function importContactsCsv(db: PrismaClient, csv: string): Promise<ImportReport> {
  const report: ImportReport = { updated: 0, skipped: [] };

  for (const rec of parseCsvRecords(csv)) {
    const igScopedId = rec.igScopedId?.trim();
    const username = rec.username?.trim();
    const contact = igScopedId
      ? await db.contact.findUnique({
          where: { igScopedId },
          include: { tags: { include: { tag: true } } },
        })
      : username
        ? await db.contact.findFirst({
            where: { username },
            include: { tags: { include: { tag: true } } },
          })
        : null;

    if (!contact) {
      report.skipped.push(igScopedId || username || "(linha sem identificador)");
      continue;
    }

    const data: { name?: string; username?: string } = {};
    if (rec.name?.trim()) data.name = rec.name.trim();
    if (username && username !== contact.username) data.username = username;
    if (Object.keys(data).length) await db.contact.update({ where: { id: contact.id }, data });

    if (rec.tags !== undefined && rec.tags !== "") {
      const wanted = new Set(
        rec.tags
          .split("|")
          .map((t) => t.trim())
          .filter(Boolean),
      );
      const current = new Set(contact.tags.map((t) => t.tag.name));
      for (const name of wanted)
        if (!current.has(name)) await addTagToContact(db, contact.id, name, "csv");
      for (const name of current)
        if (!wanted.has(name)) await removeTagFromContact(db, contact.id, name, "csv");
    }

    if (rec.subscribed?.trim()) {
      const on = TRUE_WORDS.has(rec.subscribed.trim().toLowerCase());
      if (on !== contact.subscribed) await setContactSubscribed(db, contact.id, on, "csv");
    }

    for (const [col, value] of Object.entries(rec)) {
      if (!col.startsWith(FIELD_PREFIX) || value === "") continue;
      await saveContactField(db, contact.id, col.slice(FIELD_PREFIX.length), value);
    }

    report.updated++;
  }

  return report;
}
