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
// /api/health is public for uptime monitors; it returns statuses, no values.
// Only /_next/static is public: the build assets the login page itself needs.
// The wider "/_next" used to wave through /_next/image, an unauthenticated
// native image decoder (the optimizer is off in next.config.mjs now, and the
// matcher below no longer exempts it either).
const PUBLIC_PREFIXES = [
  "/api/webhook",
  "/api/cron",
  "/api/health",
  "/login",
  "/privacidade",
  "/_next/static",
  "/favicon",
];
const COOKIE = "mc_auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Fail closed. No configured secret in production must lock the panel, not
  // open it — the opposite default would silently expose every contact.
  //
  // The gate is authSecret(), not ADMIN_PASSWORD: a deployment that sets only
  // AUTH_SECRET can verify cookies perfectly well, and checking the password
  // here used to 503 it into a panel nobody could open.
  const secret = authSecret();
  if (secret === null) {
    return new NextResponse(
      "Neither AUTH_SECRET nor ADMIN_PASSWORD is set. The panel is locked until one is configured.",
      { status: 503 },
    );
  }

  if (await verifyToken(secret, req.cookies.get(COOKIE)?.value)) {
    return NextResponse.next();
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
