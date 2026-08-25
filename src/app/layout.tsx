import "./globals.css";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { db } from "../server/db";
import { unreadConversationCount } from "../server/inbox";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "ManyChat Clone" };

// The unread count is read on every request; nothing here is prerendered.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-foreground">
        <AppShell unreadConversations={await unreadBadge()}>{children}</AppShell>
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
