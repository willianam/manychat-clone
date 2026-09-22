/**
 * The failure half of a server action's return value.
 *
 * Next strips the message of an uncaught Server Action error in production and
 * hands the client a digest instead, so a sentence written for the operator
 * only survives when it comes back as a value. `gatilhos/actions.ts` set this
 * pattern; `withToast` shows whatever lands here.
 */
export type ActionFailure = { ok: false; error: string };

export function actionFailure(error: string): ActionFailure {
  return { ok: false, error };
}

export function isActionFailure(value: unknown): value is ActionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ActionFailure).ok === false &&
    typeof (value as ActionFailure).error === "string"
  );
}
