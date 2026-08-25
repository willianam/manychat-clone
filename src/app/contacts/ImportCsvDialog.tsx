"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { applyImport, previewImport } from "./import-actions";
import type { ImportReport } from "../../server/contacts-csv";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withToast } from "@/lib/ui/action-toast";

/**
 * CSV import in two steps: pick a file, see what it would do, then apply.
 *
 * The preview is a real dry run on the server (same matcher, no writes), so
 * the numbers it shows are the numbers the apply will produce. Import only
 * updates existing contacts — the dialog says so up front, because a file of
 * strangers would otherwise come back as "all skipped" and look like a bug.
 */
export function ImportCsvDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setCsv(null);
    setFileName("");
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    setPreview(null);
    if (!file) return reset();
    setFileName(file.name);
    start(async () => {
      const text = await file.text();
      setCsv(text);
      const report = await withToast(() => previewImport(text), {
        error: "Não foi possível ler o arquivo.",
      });
      if (report) setPreview(report);
    });
  };

  const apply = () =>
    start(async () => {
      if (!csv) return;
      const report = await withToast(() => applyImport(csv), {
        error: "A importação falhou.",
      });
      if (!report) return;
      setOpen(false);
      reset();
      router.refresh();
      toast.success(
        `${report.updated} contato(s) atualizado(s), ${report.skipped.length} ignorado(s).`,
      );
    });

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Upload aria-hidden />
        Importar CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar CSV</DialogTitle>
            <DialogDescription>
              Atualiza contatos que já existem, casando por igScopedId ou @username. Ninguém é
              criado: só quem já escreveu para a conta pode receber mensagens. Use o arquivo
              exportado daqui como modelo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="import-file">Arquivo</Label>
            <Input
              id="import-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>

          {pending && !preview && csv === null && fileName && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Lendo {fileName}…
            </p>
          )}

          {preview && (
            <div className="space-y-2" aria-live="polite">
              <Callout tone={preview.updated > 0 ? "info" : "warning"}>
                <p>
                  <strong>{preview.total}</strong> linha(s): <strong>{preview.updated}</strong>{" "}
                  seria(m) atualizada(s), <strong>{preview.skipped.length}</strong> ignorada(s) por
                  não casar com nenhum contato.
                </p>
                {preview.skipped.length > 0 && (
                  <p className="mt-1 text-xs">
                    Ignoradas: {preview.skipped.slice(0, 8).join(", ")}
                    {preview.skipped.length > 8 && ` e mais ${preview.skipped.length - 8}`}
                  </p>
                )}
                {preview.unknownColumns.length > 0 && (
                  <p className="mt-1 text-xs">
                    Colunas desconhecidas (ignoradas): {preview.unknownColumns.join(", ")}
                  </p>
                )}
              </Callout>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={pending || !preview || preview.updated === 0}
            >
              {pending && preview ? "Aplicando…" : "Aplicar importação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
