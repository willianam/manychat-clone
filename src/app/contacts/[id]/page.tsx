import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "../../../server/db";
import { contactTimeline } from "../../../server/contact-timeline";
import { humanAgentAllowed } from "../../../server/contact-panel";
import { listCustomFields } from "../../../server/custom-fields";
import { toTimelineDto } from "../../../lib/ui/timeline";
import { ContactHeader } from "./ContactHeader";
import { FieldsEditor } from "./FieldsEditor";
import { Notes } from "./Notes";
import { SendMessageDialog } from "./SendMessageDialog";
import { Sessions } from "./Sessions";
import { TagEditor } from "./TagEditor";
import { Timeline } from "./Timeline";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      tags: { include: { tag: true }, orderBy: { addedAt: "asc" } },
      fields: true,
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      flowSessions: {
        where: { status: { in: ["ACTIVE", "WAITING_INPUT"] } },
        orderBy: { startedAt: "desc" },
        include: { flow: { select: { name: true } } },
      },
    },
  });
  if (!contact) notFound();

  const [allTags, fieldDefs, timeline] = await Promise.all([
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    listCustomFields(db),
    contactTimeline(db, id, { limit: 50 }),
  ]);

  const values = Object.fromEntries(contact.fields.map((f) => [f.key, f.value]));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contacts">
            <ArrowLeft aria-hidden />
            Contatos
          </Link>
        </Button>
        <SendMessageDialog
          contactId={contact.id}
          lastInboundAt={contact.lastInboundAt?.toISOString() ?? null}
          subscribed={contact.subscribed}
          humanAgentAllowed={humanAgentAllowed()}
        />
      </div>

      <ContactHeader
        contact={{
          id: contact.id,
          name: contact.name,
          username: contact.username,
          profilePic: contact.profilePic,
          source: contact.source,
          subscribed: contact.subscribed,
          lastInboundAt: contact.lastInboundAt?.toISOString() ?? null,
          createdAt: contact.createdAt.toISOString(),
        }}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <TagEditor
            contactId={contact.id}
            tags={contact.tags.map((t) => t.tag)}
            allTags={allTags}
          />
          <FieldsEditor
            contactId={contact.id}
            fields={fieldDefs.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              defaultValue: f.defaultValue,
            }))}
            values={values}
          />
          <Sessions
            contactId={contact.id}
            sessions={contact.flowSessions.map((s) => ({
              id: s.id,
              flowId: s.flowId,
              flowName: s.flow.name,
              status: s.status,
              currentNodeId: s.currentNodeId,
              startedAt: s.startedAt.toISOString(),
              resumeAt: s.resumeAt?.toISOString() ?? null,
            }))}
          />
          <Notes
            contactId={contact.id}
            notes={contact.notes.map((n) => ({
              id: n.id,
              text: n.text,
              createdAt: n.createdAt.toISOString(),
            }))}
          />
        </div>
        <Timeline
          contactId={contact.id}
          initial={{
            items: timeline.items.map(toTimelineDto),
            nextBefore: timeline.nextBefore?.toISOString() ?? null,
          }}
        />
      </div>
    </main>
  );
}
