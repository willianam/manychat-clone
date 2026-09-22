/**
 * The single classifier for "what happened to this broadcast recipient".
 *
 * There used to be two, disagreeing on granularity: `bucketOf` in
 * broadcast-detail.ts (six buckets, "pulado" split out of "falhou") and an
 * inline loop in `broadcastReport` (three buckets, SENT/DELIVERED/READ folded
 * together, out-of-window counted separately afterwards). Same domain, same
 * rows, two places to remember whenever a new way to fail appears.
 *
 * Now there is one ladder: `bucketOf` decides, and `reportBucketOf` folds its
 * six buckets into the three the status report shows. This module owns
 * `isWindowError` too — broadcast-worker re-exports it — so the classifier
 * does not have to import from the worker and the worker from the classifier.
 */

/**
 * The error substrings `canSend` produces when the messaging window is the
 * reason nothing was sent. Kept as a list, not only as a regex, because the
 * same distinction has to be expressed as a Prisma `where` when the rows are
 * counted in the database instead of in memory — one source, no drift.
 */
export const WINDOW_ERROR_PHRASES = [
  "messaging window",
  "never sent us a message",
  "HUMAN_AGENT window",
] as const;

/** A FAILED row whose error came from the window check: the send never happened. */
export function isWindowError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return WINDOW_ERROR_PHRASES.some((p) => lower.includes(p.toLowerCase()));
}

export type RecipientBucket = "pending" | "sent" | "delivered" | "read" | "failed" | "skipped";

export const BUCKET_LABEL: Record<RecipientBucket, string> = {
  pending: "na fila",
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
  skipped: "pulado (fora da janela)",
};

/**
 * "Skipped" is a FAILED row whose error came from the window check: the
 * send never happened and retrying cannot help. Everything else under
 * FAILED is a real failure `retryFailed` will pick up.
 */
export function bucketOf(status: string, error: string | null): RecipientBucket {
  switch (status) {
    case "PENDING":
      return "pending";
    case "SENT":
      return "sent";
    case "DELIVERED":
      return "delivered";
    case "READ":
      return "read";
    default:
      return isWindowError(error) ? "skipped" : "failed";
  }
}

/** The coarser view the status report shows. "Skipped" is a failure that did not happen. */
export type ReportBucket = "pending" | "sent" | "failed";

export function reportBucketOf(status: string, error: string | null): ReportBucket {
  const bucket = bucketOf(status, error);
  if (bucket === "pending") return "pending";
  if (bucket === "failed" || bucket === "skipped") return "failed";
  return "sent";
}

/** The recipient statuses that roll up into each report bucket, for SQL/groupBy. */
export const STATUSES_BY_REPORT_BUCKET = {
  pending: ["PENDING"],
  sent: ["SENT", "DELIVERED", "READ"],
  failed: ["FAILED"],
} as const;
