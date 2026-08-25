import { cn } from "@/lib/ui/cn";

export type StatusTone = "success" | "neutral" | "warning" | "destructive" | "info";

const TONES: Record<StatusTone, string> = {
  success: "bg-emerald-50 text-emerald-700",
  // 700, not 500: the pill renders at 10px, where neutral-500 on
  // neutral-100 falls below the 4.5:1 contrast minimum.
  neutral: "bg-neutral-100 text-neutral-700",
  warning: "bg-amber-50 text-amber-700",
  destructive: "bg-rose-50 text-rose-700",
  info: "bg-indigo-50 text-indigo-700",
};

/**
 * The one status pill. Flows, triggers, broadcasts and links all describe
 * their state with it, so "ativo" looks the same everywhere.
 */
export function StatusPill({
  tone,
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone: StatusTone }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
