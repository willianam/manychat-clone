import "./globals.css";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { db } from "../server/db";
import { unreadConversationCount } from "../server/inbox";
import { connectionStatus } from "../server/connection-status";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "ManyChat Clone" };

// The unread count and the connection status are read on every request;
// nothing here is prerendered.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Connection details only for a signed-in browser: the login page must not
  // carry token details in its payload. The middleware has already verified
  // the cookie on every route that renders the shell; here its presence is
  // enough. Never throws: a dead database paints the light red instead of a 500.
  const signedIn = (await cookies()).has("mc_auth");
  const connection = signedIn
    ? await connectionStatus(db)
    : { level: "down" as const, label: "sem sessão", detail: [] };
  // Same gate for the badge: /login and /privacidade render bare anyway.
  const unreadConversations = signedIn ? await unreadBadge() : 0;
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-foreground">
        <AppShell connection={connection} unreadConversations={unreadConversations}>
          {children}
        </AppShell>
        <Toaster />
      </body>
    </html>
  );
}

/**
 * Unread conversations for the sidebar badge. Swallows failures: the
 * layout also wraps /login and /privacidade, which must render when the
 * database is down — the page's own query will surface the error.
 */
async function unreadBadge(): Promise<number> {
  try {
    return await unreadConversationCount(db);
  } catch {
    return 0;
  }
}
