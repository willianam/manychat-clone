"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GuardedLink } from "@/components/ui/guarded-link";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { isBareRoute, titleFor } from "./nav";

/**
 * App chrome: fixed sidebar on desktop, a sheet on mobile, and a header with
 * the page title and the connection slot.
 *
 * Login and the privacy policy render bare — one has no session to show a
 * sidebar for, the other is read by Meta's reviewers, not by the owner.
 */
export function AppShell({
  children,
  unreadConversations = 0,
}: {
  children: React.ReactNode;
  /** Badge on the inbox item; the root layout counts it. */
  unreadConversations?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (isBareRoute(pathname)) return <>{children}</>;

  const badges = { "/inbox": unreadConversations };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">
        <Brand />
        <SidebarNav badges={badges} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Brand />
              <SidebarNav onNavigate={() => setOpen(false)} badges={badges} />
            </SheetContent>
          </Sheet>

          <h2 className="truncate text-sm font-semibold">{titleFor(pathname)}</h2>

          <ConnectionStatus />
        </header>

        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <GuardedLink
      href="/"
      className="flex h-14 items-center gap-2 border-b px-4 font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <MessageCircle className="h-4 w-4" aria-hidden />
      </span>
      ManyChat Clone
    </GuardedLink>
  );
}

/**
 * Slot for the Instagram connection state. The backend does not expose it
 * yet (another front is building it), so this is a static placeholder.
 */
function ConnectionStatus() {
  return (
    <span
      className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
      title="Estado da conexão com o Instagram (placeholder)"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      conectado
    </span>
  );
}
