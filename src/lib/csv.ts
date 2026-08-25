/**
 * Minimal RFC 4180 CSV: comma separated, double quotes around any field
 * holding a comma, quote or newline, quotes doubled inside. Handles \r\n.
 * Pure, so the contact import/export can be tested without a database.
 */

/**
 * Cells starting with one of these are read as a FORMULA by Excel, Sheets and
 * LibreOffice, not as text. An Instagram display name is chosen by a stranger,
 * so `=HYPERLINK(...)` in a contact's name would execute in the operator's
 * spreadsheet on open. Prefixing with an apostrophe forces the cell to text;
 * the spreadsheet does not display the apostrophe.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function serializeCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = FORMULA_LEAD.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing empty line is not a record.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Rows as objects keyed by the header line. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}
