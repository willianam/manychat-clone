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
            <Link href="/gatilhos" className="text-sm text-neutral-600 hover:text-neutral-900">
              Gatilhos
            </Link>
            <Link href="/contacts" className="text-sm text-neutral-600 hover:text-neutral-900">
              Contatos
            </Link>
            <Link href="/tags" className="text-sm text-neutral-600 hover:text-neutral-900">
              Etiquetas
            </Link>
            <Link href="/campos" className="text-sm text-neutral-600 hover:text-neutral-900">
              Campos
            </Link>
            <Link href="/broadcasts" className="text-sm text-neutral-600 hover:text-neutral-900">
              Disparos
            </Link>
            <Link href="/insights" className="text-sm text-neutral-600 hover:text-neutral-900">
              Insights
            </Link>
            <Link href="/ref-links" className="text-sm text-neutral-600 hover:text-neutral-900">
              Links
            </Link>
            <Link href="/configuracoes" className="text-sm text-neutral-600 hover:text-neutral-900">
              Configurações
            </Link>
            <span className="ml-auto rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">
              produção
            </span>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
