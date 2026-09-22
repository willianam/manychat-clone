import { NextRequest, NextResponse } from "next/server";
import { uploadAttachment } from "../../../server/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Uploading 25 MB to Meta is slower than a normal request. */
export const maxDuration = 60;

/** Meta's per-type ceilings, in bytes. */
const MAX_BYTES: Record<string, number> = {
  image: 8 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

const ACCEPTED: Record<string, RegExp> = {
  image: /^image\/(jpeg|png|gif|webp)$/,
  audio: /^audio\//,
  video: /^video\//,
  // Instagram accepts PDF only for the `file` type.
  file: /^application\/pdf$/,
};

/**
 * Send a file straight to Meta and return its reusable attachment id.
 *
 * This is what lets a flow use a local audio file without hosting it
 * anywhere first. The id can then be sent to any number of contacts without
 * re-uploading, which also makes broadcasts cheaper than URL sends.
 *
 * Sits behind the admin password like the rest of the panel — the middleware
 * only exempts the webhook and cron paths.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
  }

  const file = form.get("file");
  const type = String(form.get("type") ?? "");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Nenhum arquivo recebido." }, { status: 400 });
  }
  if (!MAX_BYTES[type]) {
    return NextResponse.json({ error: `Tipo desconhecido: ${type}.` }, { status: 400 });
  }

  // Check size before spending the upload — Meta rejects it anyway, but far
  // more slowly and with a less useful message.
  const limit = MAX_BYTES[type]!;
  if (file.size > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    return NextResponse.json(
      { error: `Arquivo de ${(file.size / 1024 / 1024).toFixed(1)} MB; o limite é ${mb} MB.` },
      { status: 413 },
    );
  }

  // An absent Content-Type is a FAILURE, not a pass. The client writes the
  // multipart part header, so `if (file.type && ...)` let a Blob with no type
  // skip the format check entirely.
  const accepted = ACCEPTED[type]!;
  if (!file.type || !accepted.test(file.type)) {
    return NextResponse.json(
      {
        error: !file.type
          ? "O arquivo veio sem tipo (Content-Type). Reenvie pelo seletor de arquivos."
          : type === "file"
            ? "O Instagram aceita apenas PDF neste bloco."
            : `Formato ${file.type} não é aceito para ${type}.`,
      },
      { status: 415 },
    );
  }

  try {
    const attachmentId = await uploadAttachment(file, type as "image" | "audio" | "video" | "file");
    return NextResponse.json({ attachmentId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha no upload." },
      { status: 502 },
    );
  }
}
