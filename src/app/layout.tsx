import "./globals.css";
import Link from "next/link";

export const metadata = { title: "ManyChat Clone — Preview" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <Link href="/" className="font-semibold">
              ManyChat Clone
            </Link>
            <Link href="/flows" className="text-sm text-neutral-600 hover:text-neutral-900">
              Fluxos
            </Link>
            <Link href="/contacts" className="text-sm text-neutral-600 hover:text-neutral-900">
              Contatos
            </Link>
            <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">
              preview local · sem conexão com a Meta
            </span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
