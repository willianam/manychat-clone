import { redirect } from "next/navigation";

/**
 * Report a server-action failure on a screen built from plain `<form action>`.
 *
 * Throwing is what these actions used to do, and it costs the message: Next
 * replaces the text of an uncaught Server Action error in production with a
 * generic sentence plus a digest, and the route's `error.tsx` then swaps the
 * whole screen — list, forms and the values just typed — for "Algo deu errado".
 *
 * Redirecting back with the sentence in `?erro=` keeps the screen and keeps the
 * words. Client components have the better option and use it: return
 * `{ ok: false, error }` and let `withToast` show it.
 */
export function failForm(path: string, message: string): never {
  redirect(`${path}?erro=${encodeURIComponent(message)}`);
}

/** The sentence `failForm` left in the URL, ready to render. */
export function formError(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw?.trim();
  return text ? text.slice(0, 300) : null;
}
