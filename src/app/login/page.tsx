import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { MessageCircle } from "lucide-react";
import { authSecret, constantTimeEqual, signToken, SESSION_TTL_MS } from "../../lib/auth-token";
import { loginRateLimiter } from "../../lib/login-rate-limit";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </span>
          <CardTitle>ManyChat Clone</CardTitle>
          <CardDescription>Painel privado. Informe a senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={login} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                name="password"
                autoFocus
                required
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            {error && (
              <Callout tone="destructive" id="login-error">
                {error === "rate"
                  ? "Muitas tentativas. Aguarde 15 minutos e tente de novo."
                  : "Senha incorreta."}
              </Callout>
            )}

            <SubmitButton className="w-full" pendingLabel="Entrando…">
              Entrar
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
