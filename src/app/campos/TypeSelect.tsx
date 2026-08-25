"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/ui/cn";

const TYPES = [
  { value: "text", label: "texto" },
  { value: "number", label: "número" },
  { value: "date", label: "data" },
  { value: "boolean", label: "sim/não" },
] as const;

/** Field type picker for server-action forms: posts exactly one `name` value via a hidden input. */
export function TypeSelect({
  id,
  name,
  defaultValue = "text",
  className,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={(v) => v && setValue(v)}>
        <SelectTrigger id={id} className={cn("w-32", className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
