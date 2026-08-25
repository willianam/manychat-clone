"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix Select cannot hold "" as an item, so "sem fluxo" is a sentinel the hidden input maps back. */
const NONE = "__none__";

/**
 * Flow picker that always posts exactly one `name` value, "" for "no flow".
 * The settings actions read parallel `getAll()` arrays, so every row must
 * emit a value even when empty.
 */
export function FlowSelect({
  id,
  name,
  defaultValue = "",
  flows,
  className,
  noneLabel = "sem fluxo",
}: {
  id: string;
  name: string;
  defaultValue?: string;
  flows: Array<{ id: string; name: string }>;
  className?: string;
  /** Text of the empty item; the posted value is always "". */
  noneLabel?: string;
}) {
  const [value, setValue] = useState(defaultValue || NONE);
  return (
    <>
      <input type="hidden" name={name} value={value === NONE ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={id} className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {flows.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
