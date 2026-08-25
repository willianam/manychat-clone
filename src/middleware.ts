import { NextRequest, NextResponse } from "next/server";
import { authSecret, verifyToken } from "./lib/auth-token";

/**
 * Gate for everything except the Meta webhook.
 *
 * The webhook MUST stay open: Meta authenticates itself by signing the body
 * (verify-signature.ts), not by carrying our password. Everything else —
 * the dashboard, the flow editor, the admin API — is behind a single
 * password, which is the right weight for a personal deployment. The
 * cookie is a signed, expiring token (lib/auth-token.ts), never the
 * password itself.
 *
 * The cron endpoint is open to the internet by URL but checks CRON_SECRET
 * itself, because Vercel Cron cannot send a cookie.
 */

// Meta fetches /privacidade unauthenticated while reviewing the app, so a
// login wall there reads as a missing policy and blocks publishing.
const PUBLIC_PREFIXES = [
  "/api/webhook",
  "/api/cron",
  "/login",
  "/privacidade",
  "/_next",
  "/favicon",
];
const COOKIE = "mc_auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Fail closed. A missing password in production must lock the panel, not
  // open it — the opposite default would silently expose every contact.
  if (!process.env.ADMIN_PASSWORD) {
    return new NextResponse(
      "ADMIN_PASSWORD is not set. The panel is locked until it is configured.",
      { status: 503 },
    );
  }

  const secret = authSecret();
  if (secret && (await verifyToken(secret, req.cookies.get(COOKIE)?.value))) {
    return NextResponse.next();
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
