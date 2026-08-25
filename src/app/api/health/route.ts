import { NextResponse } from "next/server";
import { db } from "../../../server/db";
import { checkHealth } from "../../../server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public liveness/readiness summary — no secret, no cookie. It is listed in
 * the middleware's public prefixes; everything it returns is a status, not
 * a value (see server/health.ts). 503 when the database is unreachable so
 * an uptime monitor can alert on the status code alone.
 */
export async function GET() {
  const health = await checkHealth(db);
  return NextResponse.json(health, { status: health.db === "ok" ? 200 : 503 });
}
