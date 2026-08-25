import { toast } from "sonner";

/**
 * Run a server action from a client component and toast the outcome.
 *
 * Next signals `redirect()` by throwing; that error must keep propagating or
 * the navigation never happens, so it is re-thrown untouched.
 */
export async function withToast<T>(
  run: () => Promise<T>,
  messages: { success?: string; error?: string },
): Promise<T | undefined> {
  try {
    const result = await run();
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
