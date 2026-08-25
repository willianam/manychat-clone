import { Download } from "lucide-react";
import type { RefLinkDay } from "../../server/ref-link-stats";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { SERIES } from "@/lib/ui/chart-palette";

/**
 * The fold-out under a link: its 30-day series and the QR code.
 *
 * `qrDataUrl` is rendered on the server (qrcode → PNG data URL) so the
 * download is a plain anchor, no client code. Collapsed by default: the
 * list stays scannable with many links, and the chart is only mounted on
 * open.
 */
export function LinkInsights({
  code,
  rows,
  qrDataUrl,
}: {
  code: string;
  rows: RefLinkDay[];
  qrDataUrl: string | null;
}) {
  const clicks30 = rows.reduce((n, r) => n + r.clicks, 0);
  const contacts30 = rows.reduce((n, r) => n + r.contacts, 0);

  return (
    <details className="mt-3 rounded-lg border bg-neutral-50/60">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        Últimos 30 dias: {clicks30} {clicks30 === 1 ? "clique" : "cliques"} · {contacts30}{" "}
        {contacts30 === 1 ? "contato novo" : "contatos novos"}
        {qrDataUrl && " · QR code"}
      </summary>
      <div className="grid gap-4 border-t p-3 md:grid-cols-[minmax(0,1fr)_160px]">
        <TimeSeriesChart
          kind="line"
          height={160}
          title="Cliques e contatos novos por dia"
          rows={rows}
          series={[
            { key: "clicks", label: "cliques", color: SERIES[0] },
            { key: "contacts", label: "contatos novos", color: SERIES[1] },
          ]}
        />
        {qrDataUrl && (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, no optimization possible */}
            <img
              src={qrDataUrl}
              alt={`QR code do link ${code}`}
              width={128}
              height={128}
              className="rounded-md border bg-white"
            />
            <a
              href={qrDataUrl}
              download={`ig-me-${code}.png`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Baixar PNG
            </a>
          </div>
        )}
      </div>
    </details>
  );
}
