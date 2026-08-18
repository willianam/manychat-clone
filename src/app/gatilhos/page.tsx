import { db } from "../../server/db";
import { listMedia } from "../../server/ig-media-cache";
import { mediaLabel } from "../../lib/ig-media";
import { TriggerList, type TriggerRowData } from "./TriggerList";
import type { TriggerView } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Every trigger in the account, in one list.
 *
 * The flow editor answers "what makes THIS flow run"; this page answers the
 * question you can only ask from outside a flow — "what can start anything at
 * all, and is any of it fighting with anything else". Ordering is by kind
 * then priority, which is the order the dispatcher itself resolves them in,
 * so the list reads as the decision the runtime will actually make.
 *
 * Media captions are resolved server-side so a post-specific trigger says
 * which post rather than showing a bare id. A failure to reach Meta degrades
 * to the id — the list must render when Instagram is down.
 */
export default async function TriggersPage() {
  const [triggers, flows, mediaResult] = await Promise.all([
    db.trigger.findMany({
      include: { flow: { select: { name: true, enabled: true } } },
      orderBy: [{ kind: "asc" }, { priority: "desc" }],
    }),
    db.flow.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listMedia(),
  ]);

  const captions = new Map(mediaResult.media.map((m) => [m.id, mediaLabel(m)]));

  const rows: TriggerRowData[] = triggers.map((t) => {
    const view: TriggerView = {
      id: t.id,
      flowId: t.flowId,
      flowName: t.flow.name,
      flowEnabled: t.flow.enabled,
      kind: t.kind,
      pattern: t.pattern,
      match: t.match,
      mediaId: t.mediaId,
      enabled: t.enabled,
      priority: t.priority,
      summary: "",
    };
    return {
      trigger: view,
      mediaLabel: t.mediaId ? (captions.get(t.mediaId) ?? null) : null,
    };
  });

  const live = rows.filter((r) => r.trigger.enabled && r.trigger.flowEnabled).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Gatilhos</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {rows.length} {rows.length === 1 ? "gatilho" : "gatilhos"} · {live}{" "}
            realmente no ar
          </p>
        </div>
      </div>

      <TriggerList rows={rows} flows={flows} />

      <p className="mt-6 text-xs text-neutral-400">
        Um gatilho só dispara se ele estiver ativo <em>e</em> o fluxo de destino
        também estiver. Para comentários, um gatilho preso a uma publicação
        específica ganha do que vale para qualquer publicação.
      </p>
    </main>
  );
}
