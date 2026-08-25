import "./globals.css";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { db } from "../server/db";
import { connectionStatus } from "../server/connection-status";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "ManyChat Clone" };

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Only for a signed-in browser: the login page must not carry token
  // details in its payload. The middleware has already verified the cookie
  // on every route that renders the shell; here its presence is enough.
  // Never throws: a dead database paints the light red instead of a 500.
  const signedIn = (await cookies()).has("mc_auth");
  const connection = signedIn
    ? await connectionStatus(db)
    : { level: "down" as const, label: "sem sessão", detail: [] };
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-foreground">
        <AppShell connection={connection}>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
