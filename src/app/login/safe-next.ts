/**
 * Where to land after a successful login.
 *
 * The value rides in a hidden field fed by `?next=`, so it is attacker
 * input: `/login?next=https://painel-falso.example/login` used to send the
 * operator to a copy of the panel right after a real, successful login —
 * phishing for the one password that opens everything. Only an internal
 * absolute path survives; `//evil.com` and `/\evil.com` are protocol-relative
 * URLs the browser treats as external, so they go too.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined): string {
  const target = String(value ?? "/");
  if (!target.startsWith("/")) return "/";
  if (target.startsWith("//") || target.startsWith("/\\")) return "/";
  return target;
}
