"use client";

import { useState } from "react";
import type { QuickReplyTemplate } from "@prisma/client";
import { QuickRepliesDialog } from "../inbox/QuickRepliesDialog";
import { Button } from "@/components/ui/button";

/**
 * Opens the inbox's quick-reply manager from the settings tab. The CRUD
 * already exists and is the same dialog the inbox uses, so this is a button,
 * not a second implementation of the same forms.
 */
export function QuickRepliesManager({ items }: { items: QuickReplyTemplate[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Gerenciar respostas
      </Button>
      <QuickRepliesDialog open={open} onOpenChange={setOpen} items={items} />
    </>
  );
}
