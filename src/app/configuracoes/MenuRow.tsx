"use client";

import { useState } from "react";
import { PROFILE_LIMITS, type MenuItemInput } from "../../lib/messenger-profile";

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
      <span className="w-4 text-sm text-neutral-400 tabular-nums">{index + 1}</span>

      <input
        name="menuTitle"
        defaultValue={item?.title ?? ""}
        maxLength={PROFILE_LIMITS.menuTitle}
        placeholder="Falar com atendente"
        className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
      />

      <select
        name="menuType"
        value={type}
        onChange={(e) => setType(e.target.value as "postback" | "web_url")}
        className="w-28 rounded-lg border bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
      >
        <option value="postback">Fluxo</option>
        <option value="web_url">Link</option>
      </select>

      <select
        name="menuFlowId"
        defaultValue={item?.type === "postback" ? item.flowId : ""}
        className={`w-52 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 ${
          type === "postback" ? "" : "hidden"
        }`}
      >
        <option value="">— sem fluxo —</option>
        {flows.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <input
        name="menuUrl"
        type="url"
        defaultValue={item?.type === "web_url" ? item.url : ""}
        placeholder="https://..."
        className={`w-52 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400 ${
          type === "web_url" ? "" : "hidden"
        }`}
      />
    </div>
  );
}
