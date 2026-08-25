import { Check, Users, X } from "lucide-react";
import { db } from "../../server/db";
import { canSend } from "../../lib/messaging-window";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TagChip } from "@/components/ui/tag-chip";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await db.contact.findMany({
    include: { tags: { include: { tag: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Contatos"
        description={`${contacts.length} ${contacts.length === 1 ? "contato" : "contatos"}`}
      />

      {contacts.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title="Nenhum contato ainda."
          description="Contatos aparecem aqui assim que alguém escrever para a conta conectada no Instagram."
        />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {contacts.map((c) => {
            const d = canSend(c.lastInboundAt);
            return (
              <Card key={c.id}>
                <CardContent className="p-4">
                  <div className="font-medium">{c.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">@{c.username ?? "sem-user"}</div>
                  {c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <TagChip key={t.tagId} name={t.tag.name} color={t.tag.color} />
                      ))}
                    </div>
                  )}
                  <div
                    className={`mt-3 inline-flex items-center gap-1 text-xs ${
                      d.allowed ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {d.allowed ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <X className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {d.allowed ? "dentro da janela de 24h" : d.reason}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
