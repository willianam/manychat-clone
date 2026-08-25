"use client";

import { usePathname } from "next/navigation";
import { NAV, isActive } from "./nav";
import { GuardedLink } from "@/components/ui/guarded-link";
import { cn } from "@/lib/ui/cn";

/**
 * The nav list, shared by the desktop sidebar and the mobile sheet.
 *
 * `badges` maps an href to a count shown at the end of its row — today
 * only the inbox's unread conversations, computed by the root layout.
 */
export function SidebarNav({
  onNavigate,
  badges = {},
}: {
  onNavigate?: () => void;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5 p-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        const badge = badges[href] ?? 0;
        return (
          <GuardedLink
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active
                ? "bg-primary/10 text-primary"
                : "text-neutral-600 hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
            {badge > 0 && (
              <span
                className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                aria-label={`${badge} ${badge === 1 ? "conversa não lida" : "conversas não lidas"}`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </GuardedLink>
        );
      })}
    </nav>
  );
}
