"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { ThreadContact } from "../../server/inbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { TagChip } from "@/components/ui/tag-chip";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/ui/action-toast";
import { calendarDay, relativeTime } from "@/lib/ui/time";
import { addNoteAction } from "./actions";
import { Avatar } from "./Avatar";

/** Right column: who this is, what we know, and a place to write a note. */
export function ContactPanel({
  contact,
  now = new Date(),
}: {
  contact: ThreadContact;
  now?: Date;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const name = contact.name ?? (contact.username ? `@${contact.username}` : "Contato sem nome");

  async function saveNote() {
    if (!note.trim()) return;
    setSaving(true);
    const ok = await withToast(
      async () => {
        await addNoteAction(contact.id, note);
        return true;
      },
      { success: "Nota salva.", error: "Não foi possível salvar a nota." },
    );
    setSaving(false);
    if (ok) {
      setNote("");
      router.refresh();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-col items-center border-b px-4 py-5 text-center">
        <Avatar name={name} src={contact.profilePic} className="h-16 w-16 text-xl" />
        <h3 className="mt-3 font-semibold">{name}</h3>
        {contact.username && (
          <a
            href={`https://instagram.com/${contact.username}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            @{contact.username}
          </a>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          <StatusPill tone={contact.subscribed ? "success" : "destructive"}>
            {contact.subscribed ? "inscrito" : "descadastrado"}
          </StatusPill>
          {contact.automationPaused && <StatusPill tone="warning">automação pausada</StatusPill>}
        </div>
        <dl className="mt-3 w-full space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>Origem</dt>
            <dd className="truncate">{contact.source ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Desde</dt>
            <dd suppressHydrationWarning>{calendarDay(contact.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Última mensagem dele</dt>
            <dd suppressHydrationWarning>
              {contact.lastInboundAt ? relativeTime(contact.lastInboundAt, now) : "nunca"}
            </dd>
          </div>
        </dl>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/contacts/${contact.id}`}>
            Ver contato completo <ExternalLink aria-hidden />
          </Link>
        </Button>
      </div>

      <Section title="Etiquetas">
        {contact.tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma etiqueta.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {contact.tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Campos">
        {contact.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum campo preenchido.</p>
        ) : (
          <dl className="space-y-1 text-sm">
            {contact.fields.map((f) => (
              <div key={f.key} className="flex justify-between gap-3">
                <dt className="truncate text-muted-foreground">{f.label}</dt>
                <dd className="truncate text-right">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Notas">
        <div className="space-y-2">
          <Label htmlFor="new-note" className="sr-only">
            Nova nota
          </Label>
          <Textarea
            id="new-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escreva uma nota sobre este contato"
            className="min-h-[52px]"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !note.trim()}
              onClick={() => void saveNote()}
            >
              {saving ? "Salvando…" : "Salvar nota"}
            </Button>
          </div>
        </div>
        {contact.notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {contact.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-muted px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap break-words">{n.text}</p>
                <p className="mt-1 text-[11px] text-muted-foreground" suppressHydrationWarning>
                  {relativeTime(n.createdAt, now)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}
