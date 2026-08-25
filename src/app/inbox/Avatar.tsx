/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/ui/cn";

/**
 * Profile picture with an initial as the fallback. A plain <img>: the URL
 * is an Instagram CDN link with no stable host, so next/image would need a
 * wildcard remote pattern for nothing.
 */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src: string | null;
  className?: string;
}) {
  const initial = name.replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary",
        className,
      )}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  );
}
