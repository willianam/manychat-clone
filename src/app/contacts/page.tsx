import { db } from "../../server/db";
import { canSend } from "../../lib/messaging-window";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await db.contact.findMany({
    include: { tags: { include: { tag: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Contatos</h1>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {contacts.map((c) => {
          const d = canSend(c.lastInboundAt);
          return (
            <div key={c.id} className="rounded-lg border bg-white p-4">
              <div className="font-medium">{c.name ?? "—"}</div>
              <div className="text-xs text-neutral-500">@{c.username ?? "sem-user"}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <span
                    key={t.tagId}
                    className="rounded-full px-2 py-0.5 text-xs text-white"
                    style={{ backgroundColor: t.tag.color }}
                  >
                    {t.tag.name}
                  </span>
                ))}
              </div>
              <div className={`mt-3 text-xs ${d.allowed ? "text-emerald-700" : "text-rose-700"}`}>
                {d.allowed ? "✓ dentro da janela de 24h" : `✗ ${d.reason}`}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
