import { db as defaultDb } from "./db";
import type { PrismaClient } from "@prisma/client";
import { getAccessToken } from "./token-refresh";
import { logger } from "../lib/log";

const log = logger("subscribed-apps");

/**
 * Inscrever o app na conta — `/me/subscribed_apps`.
 *
 * Assinar os campos no painel da Meta não faz evento nenhum chegar: é preciso
 * inscrever o *app* na *conta*, e isso só existe por API. O modo como isso
 * falha é o problema: sem a inscrição o handshake do webhook continua
 * devolvendo 200, a tela de configurações continua verde, e simplesmente não
 * chega evento. Quem passa por isso procura bug no código.
 *
 * Por isso a chamada virou botão. Endpoints conferidos contra
 * developers.facebook.com/docs/instagram-platform (v26.0):
 *
 *   POST /me/subscribed_apps?subscribed_fields=…   → {"success":true}
 *   GET  /me/subscribed_apps                       → {"data":[{"subscribed_fields":[…]}]}
 *
 * O GET existe, então a tela mostra o estado antes do clique em vez de
 * adivinhar. Quando ele falha por qualquer motivo, a tela diz que não
 * conseguiu consultar — nunca que está tudo certo.
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v26.0";
const BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const SELF = process.env.IG_USER_ID ?? "me";

/**
 * Os campos que este app sabe processar, na mesma ordem do curl do README.
 * `message_reactions` fica de fora: nenhuma rota trata reação hoje, e assinar
 * um campo que ninguém lê só gera tráfego.
 */
export const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "comments",
  "messaging_seen",
  "messaging_referral",
] as const;

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
};

/**
 * O estado da inscrição como a tela precisa dele.
 *
 * `unknown` é um estado de primeira classe e não um erro escondido: token
 * ausente, Graph fora do ar ou endpoint recusado caem aqui, com o motivo, e a
 * tela diz "não deu para consultar" em vez de fingir que sabe.
 */
export type SubscriptionState =
  | { status: "subscribed"; fields: string[]; missing: string[] }
  | { status: "not_subscribed" }
  | { status: "unknown"; reason: string };

export async function getSubscribedApps(db: PrismaClient = defaultDb): Promise<SubscriptionState> {
  let token: string;
  try {
    token = await getAccessToken(db);
  } catch {
    return { status: "unknown", reason: "Nenhum token do Instagram: defina IG_ACCESS_TOKEN." };
  }

  try {
    const res = await fetch(`${BASE}/${SELF}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      data?: Array<{ subscribed_fields?: string[] }>;
      error?: GraphError;
    };

    if (!res.ok) return { status: "unknown", reason: explain(res.status, body.error) };

    const entries = body.data ?? [];
    if (entries.length === 0) return { status: "not_subscribed" };

    const fields = entries.flatMap((e) => e.subscribed_fields ?? []);
    if (fields.length === 0) return { status: "not_subscribed" };

    return {
      status: "subscribed",
      fields,
      missing: SUBSCRIBED_FIELDS.filter((f) => !fields.includes(f)),
    };
  } catch (err) {
    log.warn("could not read subscribed_apps", { err });
    return {
      status: "unknown",
      reason: "Não foi possível falar com a Meta agora. Tente de novo em alguns instantes.",
    };
  }
}

export type SubscribeResult = { ok: true; fields: string[] } | { ok: false; error: string };

/** O `POST /me/subscribed_apps` do README, como chamada única. */
export async function subscribeApp(db: PrismaClient = defaultDb): Promise<SubscribeResult> {
  let token: string;
  try {
    token = await getAccessToken(db);
  } catch {
    return {
      ok: false,
      error:
        "Nenhum token do Instagram configurado. Defina IG_ACCESS_TOKEN no ambiente e reinicie o app.",
    };
  }

  const fields = [...SUBSCRIBED_FIELDS];
  let res: Response;
  let body: { success?: boolean; error?: GraphError };
  try {
    res = await fetch(`${BASE}/${SELF}/subscribed_apps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ subscribed_fields: fields.join(",") }),
    });
    body = (await res.json()) as { success?: boolean; error?: GraphError };
  } catch (err) {
    log.warn("subscribe failed", { err });
    return {
      ok: false,
      error:
        "Não foi possível falar com a Meta (rede ou API fora do ar). Tente de novo em alguns instantes.",
    };
  }

  if (!res.ok || body.success === false) {
    const error = explain(res.status, body.error);
    log.warn("subscribe rejected", { status: res.status, error });
    return { ok: false, error };
  }

  return { ok: true, fields };
}

/**
 * Transformar a recusa da Meta numa frase que diz o que fazer.
 *
 * As três causas comuns são distintas e o conserto de cada uma é outro:
 * token sem a permissão certa (refazer o token pedindo a permissão), token
 * expirado ou revogado (gerar outro), e conta que não é profissional (mudar a
 * conta no app do Instagram). "Falhou" mandaria o usuário tentar as três.
 * A mensagem crua da Meta vai junto, no fim, para quem for pesquisar.
 */
function explain(status: number, error?: GraphError): string {
  const raw = error?.message?.trim();
  const tail = raw ? ` (a Meta disse: "${raw}")` : "";
  const code = error?.code;
  const subcode = error?.error_subcode;
  const lower = (raw ?? "").toLowerCase();

  // 190 é o código de token da Graph; os subcódigos separam expirado de revogado.
  if (code === 190 || status === 401) {
    if (subcode === 463 || lower.includes("expired")) {
      return `O token do Instagram expirou. Gere um token novo no painel da Meta, atualize IG_ACCESS_TOKEN e tente de novo.${tail}`;
    }
    if (subcode === 467 || lower.includes("revoked") || lower.includes("session")) {
      return `O token do Instagram foi revogado — a senha da conta mudou, ou o acesso do app foi removido. Gere um token novo no painel da Meta.${tail}`;
    }
    return `O token do Instagram não foi aceito. Confira se IG_ACCESS_TOKEN é o token desta conta e se não veio com espaço no fim.${tail}`;
  }

  // 10, 200 e 3 são as recusas de permissão; 4 é limite de chamadas.
  if (code === 10 || code === 200 || code === 3 || status === 403) {
    return `O token não tem a permissão necessária. Ele precisa de instagram_business_manage_messages (e instagram_business_manage_comments para comentário → DM). Gere o token de novo marcando essas permissões.${tail}`;
  }

  if (code === 4 || code === 17 || code === 32 || status === 429) {
    return `A Meta está limitando as chamadas desta conta agora. Espere alguns minutos e tente de novo.${tail}`;
  }

  // 803 e 100/33 aparecem quando o /me não resolve para uma conta profissional.
  if (code === 803 || (code === 100 && subcode === 33) || code === 100) {
    return `A Meta não encontrou uma conta profissional para este token. A conta precisa ser Comercial ou de Criador de Conteúdo e estar ligada ao app; confira também IG_USER_ID, se você o definiu.${tail}`;
  }

  if (status >= 500) {
    return `A Meta respondeu com erro interno (HTTP ${status}). Não é problema da sua configuração; tente de novo em alguns minutos.${tail}`;
  }

  return `A Meta recusou a inscrição (HTTP ${status}). Confira token, permissões e se a conta é profissional.${tail}`;
}
