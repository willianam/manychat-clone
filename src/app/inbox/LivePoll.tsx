"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often the inbox re-fetches while the tab is visible. */
export const POLL_MS = 10_000;

/**
 * Live updates by polling.
 *
 * `router.refresh()` re-runs the server component and patches the tree in
 * place: no client state (a half-typed reply, the picker) is lost. Every
 * 10 s while the tab is visible, plus once on becoming visible again, so a
 * tab left in the background does not hammer the database and still shows
 * fresh data the moment it is looked at.
 *
 * SSE was considered and rejected: on Vercel a function holding a stream
 * open counts against execution time and is cut at the plan's limit, so a
 * long-lived /api/inbox/events would need its own reconnect dance for no
 * gain over a 10 s poll on a single-operator inbox.
 */
export function LivePoll({ intervalMs = POLL_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
