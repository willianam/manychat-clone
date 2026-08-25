import type { PrismaClient } from "@prisma/client";
import { tokenStatus, WARN_AHEAD_DAYS, type TokenStatus } from "./token-refresh";
import { errorSummary } from "./error-events";

/**
 * The traffic light in the header: is the bot able to answer right now?
 *
 * One of three answers, derived from what the settings page already shows
 * (token, last Meta call, recent errors). Green means nothing needs the
 * owner; amber means it works today but something will bite soon; red means
 * sends are failing or cannot happen at all. `detail` carries the reasons,
 * for the tooltip and for the settings page.
 */

export type ConnectionLevel = "ok" | "warn" | "down";

export type ConnectionStatus = {
  level: ConnectionLevel;
  label: string;
  detail: string[];
};

export type ConnectionSignals = {
  token: TokenStatus;
  lastMetaCall: { at: Date; ok: boolean } | null;
  errors24h: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarizeConnection(s: ConnectionSignals, now = new Date()): ConnectionStatus {
  const detail: string[] = [];

  if (!s.token.configured) {
    return {
      level: "down",
      label: "sem conexão",
      detail: ["Nenhum token do Instagram: defina IG_ACCESS_TOKEN."],
    };
  }
  if (s.token.lastError) {
    return {
      level: "down",
      label: "token com problema",
      detail: [`A renovação do token falhou: ${s.token.lastError}.`],
    };
  }
  if (s.token.daysLeft !== null && s.token.daysLeft < 0) {
    return { level: "down", label: "token expirado", detail: ["O token do Instagram expirou."] };
  }

  let level: ConnectionLevel = "ok";

  if (s.token.daysLeft !== null && s.token.daysLeft < WARN_AHEAD_DAYS) {
    level = "warn";
    detail.push(`O token expira em ${s.token.daysLeft} dia(s).`);
  }
  if (s.lastMetaCall && !s.lastMetaCall.ok) {
    level = "warn";
    detail.push("A última chamada à Meta falhou.");
  }
  if (s.errors24h > 0) {
    level = "warn";
    detail.push(`${s.errors24h} erro(s) nas últimas 24h.`);
  }

  if (level === "ok") {
    detail.push(
      s.lastMetaCall
        ? `Última chamada à Meta há ${elapsed(now.getTime() - s.lastMetaCall.at.getTime())}, ok.`
        : "Nenhuma mensagem enviada ainda.",
    );
    if (s.token.daysLeft !== null) detail.push(`Token válido por ${s.token.daysLeft} dia(s).`);
  }

  return { level, label: level === "ok" ? "conectado" : "atenção", detail };
}

/** Never throws: the header must render when the database does not. */
export async function connectionStatus(
  db: PrismaClient,
  now = new Date(),
): Promise<ConnectionStatus> {
  try {
    const [token, lastSend, errors] = await Promise.all([
      tokenStatus(db, now),
      db.message.findFirst({
        where: { direction: "OUTBOUND", status: { not: "PENDING" } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      }),
      errorSummary(db, new Date(now.getTime() - DAY_MS)),
    ]);
    return summarizeConnection(
      {
        token,
        lastMetaCall: lastSend
          ? { at: lastSend.createdAt, ok: lastSend.status !== "FAILED" }
          : null,
        errors24h: errors.count,
      },
      now,
    );
  } catch {
    return { level: "down", label: "banco indisponível", detail: ["O banco não respondeu."] };
  }
}

function elapsed(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
