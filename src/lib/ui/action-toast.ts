import { toast } from "sonner";
import { isActionFailure, type ActionFailure } from "./action-result";

/**
 * Run a server action from a client component and toast the outcome.
 *
 * An action that reports failure as a value — `{ ok: false, error }` — gets its
 * sentence shown and `undefined` back, the same shape a thrown error produces.
 * That is the preferred form: a thrown message is replaced by a generic one in
 * production, a returned one is not.
 *
 * Next signals `redirect()` by throwing; that error must keep propagating or
 * the navigation never happens, so it is re-thrown untouched.
 */
export async function withToast<T>(
  run: () => Promise<T | ActionFailure>,
  messages: { success?: string; error?: string },
): Promise<T | undefined> {
  try {
    const result = await run();
    if (isActionFailure(result)) {
      toast.error(result.error);
      return undefined;
    }
    if (messages.success) toast.success(messages.success);
    return result;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    toast.error(messages.error ?? "Não foi possível concluir.", {
      description: err instanceof Error && err.message ? err.message : undefined,
    });
    return undefined;
  }
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
