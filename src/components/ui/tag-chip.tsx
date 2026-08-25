import { cn } from "@/lib/ui/cn";
import { readableTextColor } from "@/lib/ui/contrast";

/**
 * A tag, painted in its own color with text that stays readable on it.
 *
 * `selected` is for pickers: an unselected chip shows the color as a dot on
 * a neutral outline, a selected one fills with the color.
 */
export function TagChip({
  name,
  color,
  selected = true,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  name: string;
  color: string;
  selected?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5";

  if (!selected) {
    return (
      <span className={cn(base, "border bg-background text-neutral-600", className)} {...rest}>
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        {name}
      </span>
    );
  }

  return (
    <span
      className={cn(base, className)}
      style={{ backgroundColor: color, color: readableTextColor(color) }}
      {...rest}
    >
      {name}
    </span>
  );
}
