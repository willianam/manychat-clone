"use client";

import { useState } from "react";
import { PROFILE_LIMITS, type MenuItemInput } from "../../lib/messenger-profile";
import { FlowSelect } from "./FlowSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/ui/cn";

/**
 * One persistent-menu slot.
 *
 * A row is either a flow or an external link, and only one of the two inputs
 * is meaningful at a time. Both are always rendered — the hidden one keeps
 * its position in the parallel `getAll()` arrays the action reads, so a row
 * switched to "link" doesn't shift every later row's flow id by one.
 */
export function MenuRow({
  index,
  item,
  flows,
}: {
  index: number;
  item?: MenuItemInput;
  flows: Array<{ id: string; name: string }>;
}) {
  const [type, setType] = useState<"postback" | "web_url">(item?.type ?? "postback");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-4 text-sm tabular-nums text-neutral-400" aria-hidden>
        {index + 1}
      </span>

      <Label htmlFor={`menu-title-${index}`} className="sr-only">
        Título do item {index + 1}
      </Label>
      <Input
        id={`menu-title-${index}`}
        name="menuTitle"
        defaultValue={item?.title ?? ""}
        maxLength={PROFILE_LIMITS.menuTitle}
        placeholder="Falar com atendente"
        className="min-w-0 flex-1"
      />

      <Label htmlFor={`menu-type-${index}`} className="sr-only">
        Tipo do item {index + 1}
      </Label>
      <Select name="menuType" value={type} onValueChange={(v) => setType(v as typeof type)}>
        <SelectTrigger id={`menu-type-${index}`} className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="postback">Fluxo</SelectItem>
          <SelectItem value="web_url">Link</SelectItem>
        </SelectContent>
      </Select>

      <div className={cn(type === "postback" ? "contents" : "hidden")}>
        <Label htmlFor={`menu-flow-${index}`} className="sr-only">
          Fluxo do item {index + 1}
        </Label>
        <FlowSelect
          id={`menu-flow-${index}`}
          name="menuFlowId"
          defaultValue={item?.type === "postback" ? item.flowId : ""}
          flows={flows}
          className="w-52"
        />
      </div>

      <Label htmlFor={`menu-url-${index}`} className="sr-only">
        Link do item {index + 1}
      </Label>
      <Input
        id={`menu-url-${index}`}
        name="menuUrl"
        type="url"
        defaultValue={item?.type === "web_url" ? item.url : ""}
        placeholder="https://..."
        className={cn("w-52", type === "web_url" ? "" : "hidden")}
      />
    </div>
  );
}
