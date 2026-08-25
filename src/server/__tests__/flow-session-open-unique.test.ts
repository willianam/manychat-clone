import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The "one open run per (contact, flow)" rule is a PARTIAL unique index, and
 * Prisma's schema language cannot express the WHERE clause. So the invariant
 * lives in raw SQL, and this test guards the pair: the schema must NOT carry a
 * full unique that includes `status`, and a migration must install the partial
 * one.
 *
 * The regression it prevents: with a full unique on
 * (contactId, flowId, status), a contact could reach COMPLETED in a given flow
 * exactly once. Every later completion hit P2002, leaving an orphan ACTIVE
 * session that made startFlow refuse the flow for that contact forever.
 */

const ROOT = join(__dirname, "..", "..", "..");
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

function flowSessionModel(): string {
  const m = schema.match(/model FlowSession \{[\s\S]*?\n\}/);
  if (!m) throw new Error("FlowSession model not found in schema.prisma");
  return m[0];
}

function allMigrationSql(): string {
  const dir = join(ROOT, "prisma", "migrations");
  return readdirSync(dir)
    .filter((d) => !d.endsWith(".toml"))
    .sort()
    .map((d) => {
      try {
        return readFileSync(join(dir, d, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

describe("FlowSession open-session uniqueness", () => {
  it("does not declare a full unique that includes status", () => {
    // This is the exact line that broke repeat completions.
    expect(flowSessionModel()).not.toMatch(/@@unique\(\[[^\]]*status[^\]]*\]\)/);
  });

  it("installs a partial unique index scoped to the open statuses", () => {
    const sql = allMigrationSql();
    expect(sql).toMatch(/CREATE UNIQUE INDEX "FlowSession_open_unique"/);

    const stmt = sql
      .slice(sql.indexOf('CREATE UNIQUE INDEX "FlowSession_open_unique"'))
      .split(";")[0]!;

    expect(stmt).toMatch(/"contactId"\s*,\s*"flowId"/);
    // The WHERE clause is the whole point: without it, COMPLETED rows collide.
    expect(stmt).toMatch(/WHERE\s+status\s+IN\s*\(\s*'ACTIVE'\s*,\s*'WAITING_INPUT'\s*\)/i);
    expect(stmt).not.toMatch(/COMPLETED|ABANDONED/);
  });

  it("drops the old full unique index", () => {
    expect(allMigrationSql()).toMatch(
      /DROP INDEX IF EXISTS "FlowSession_contactId_flowId_status_key"/,
    );
  });
});
