import { AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/ui/cn";

const TONES = {
  info: { icon: Info, className: "border-indigo-200 bg-indigo-50 text-indigo-900" },
  warning: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-900" },
  destructive: { icon: XCircle, className: "border-rose-200 bg-rose-50 text-rose-800" },
} as const;

/** Inline notice: a warning about the token, an error from the last publish. */
export function Callout({
  tone = "info",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof TONES }) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-lg border px-4 py-3 text-sm", toneClass, className)}
      {...rest}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
