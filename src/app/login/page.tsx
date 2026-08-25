import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { authSecret, constantTimeEqual, signToken, SESSION_TTL_MS } from "../../lib/auth-token";
import { loginRateLimiter } from "../../lib/login-rate-limit";

export const dynamic = "force-dynamic";

/**
 * Single-password login. Server action only — the password never reaches
 * the client bundle, and never reaches the cookie either: a successful
 * login sets a signed token that expires in 30 days (lib/auth-token.ts).
 *
 * Five wrong passwords from one IP lock that IP out for 15 minutes
 * (lib/login-rate-limit.ts).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const submitted = String(formData.get("password") ?? "");
    const expected = process.env.ADMIN_PASSWORD;
    const target = String(formData.get("next") ?? "/");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (!loginRateLimiter.allows(ip)) {
      redirect(`/login?next=${encodeURIComponent(target)}&error=rate`);
    }

    const secret = authSecret();
    if (!expected || !secret || !(await constantTimeEqual(submitted, expected))) {
      loginRateLimiter.recordFailure(ip);
      redirect(`/login?next=${encodeURIComponent(target)}&error=1`);
    }
    loginRateLimiter.reset(ip);

    (await cookies()).set("mc_auth", await signToken(secret, Date.now() + SESSION_TTL_MS), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });

    redirect(target);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <form action={login} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">ManyChat Clone</h1>
        <p className="mt-1 text-sm text-neutral-600">Painel privado. Informe a senha.</p>

        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="senha"
        />

        {error === "rate" ? (
          <p className="mt-2 text-sm text-rose-600">
            Muitas tentativas. Aguarde 15 minutos e tente de novo.
          </p>
        ) : (
          error && <p className="mt-2 text-sm text-rose-600">Senha incorreta.</p>
        )}

        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
