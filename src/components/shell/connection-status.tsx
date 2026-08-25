"use client";

import Link from "next/link";
import type { ConnectionStatus as Status } from "../../server/connection-status";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";

const STYLE = {
  ok: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  warn: { pill: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  down: { pill: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
} as const;

/**
 * The header's connection light. Hover or focus for the reasons; click goes
 * to the connection tab of the settings, where the same reasons have actions.
 */
export function ConnectionStatus({ status }: { status: Status }) {
  const style = STYLE[status.level];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/configuracoes"
            data-level={status.level}
            aria-label={`Conexão com o Instagram: ${status.label}`}
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              style.pill,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
            {status.label}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-xs">
          <ul className="space-y-0.5">
            {status.detail.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
