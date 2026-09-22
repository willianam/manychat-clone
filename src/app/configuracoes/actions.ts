"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import {
  IceBreakersInput,
  MenuItemsInput,
  type IceBreakerInput,
  type MenuItemInput,
} from "../../lib/messenger-profile";
import { pushIceBreakers, pushPersistentMenu } from "../../server/messenger-profile-api";
import { maybeRefreshToken } from "../../server/token-refresh";
import { subscribeApp } from "../../server/subscribed-apps";
import { actionFailure, type ActionFailure } from "../../lib/ui/action-result";

/**
 * Ice breakers and persistent menu.
 *
 * Both live in two places: our database (the editable copy) and Meta (the
 * live one). The order is push-then-save — if Meta rejects the change, the
 * local copy must keep matching what is actually on the account, or the
 * screen would show a configuration nobody is seeing.
 */

const PROFILE_ID = "default";

/** The single profile row, created empty on first visit. */
export async function loadProfile() {
  return db.messengerProfile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID },
    update: {},
  });
}

/**
 * Read the repeated `question[]` / `flowId[]` inputs the form posts.
 * Rows left blank are dropped rather than rejected — an empty slot in a
 * 4-slot editor means "unused", not "invalid".
 */
function readIceBreakers(formData: FormData): IceBreakerInput[] {
  const questions = formData.getAll("question").map(String);
  const flowIds = formData.getAll("iceFlowId").map(String);

  return questions
    .map((question, i) => ({ question: question.trim(), flowId: flowIds[i] ?? "" }))
    .filter((row) => row.question !== "" || row.flowId !== "");
}

function readMenuItems(formData: FormData): MenuItemInput[] {
  const titles = formData.getAll("menuTitle").map(String);
  const types = formData.getAll("menuType").map(String);
  const flowIds = formData.getAll("menuFlowId").map(String);
  const urls = formData.getAll("menuUrl").map(String);

  const rows: MenuItemInput[] = [];
  titles.forEach((rawTitle, i) => {
    const title = rawTitle.trim();
    const type = types[i] === "web_url" ? "web_url" : "postback";
    const url = (urls[i] ?? "").trim();
    const flowId = flowIds[i] ?? "";

    if (title === "" && url === "" && flowId === "") return; // unused slot

    rows.push(
      type === "web_url" ? { type: "web_url", title, url } : { type: "postback", title, flowId },
    );
  });
  return rows;
}

/** Turn Zod's issue list into one readable pt-BR sentence. */
function describe(error: { issues: Array<{ message: string }> }): string {
  const unique = [...new Set(error.issues.map((i) => i.message))];
  return unique.join(" ");
}

export async function saveIceBreakers(formData: FormData) {
  const parsed = IceBreakersInput.safeParse(readIceBreakers(formData));
  if (!parsed.success) throw new Error(describe(parsed.error));

  // Every question must point at a flow that exists and is live — a chip
  // that opens nothing is worse than no chip at all.
  await assertFlowsUsable(parsed.data.map((i) => i.flowId));

  await syncAndStore(() => pushIceBreakers(parsed.data), { iceBreakers: parsed.data as never });
}

export async function saveMenu(formData: FormData) {
  const parsed = MenuItemsInput.safeParse(readMenuItems(formData));
  if (!parsed.success) throw new Error(describe(parsed.error));

  await assertFlowsUsable(parsed.data.flatMap((i) => (i.type === "postback" ? [i.flowId] : [])));

  await syncAndStore(() => pushPersistentMenu(parsed.data), { menuItems: parsed.data as never });
}

async function assertFlowsUsable(flowIds: string[]): Promise<void> {
  if (flowIds.length === 0) return;

  const flows = await db.flow.findMany({ where: { id: { in: [...new Set(flowIds)] } } });
  const byId = new Map(flows.map((f) => [f.id, f]));

  for (const id of flowIds) {
    const flow = byId.get(id);
    if (!flow) throw new Error("Um dos fluxos escolhidos não existe mais.");
    if (!flow.enabled) {
      throw new Error(`O fluxo "${flow.name}" está desativado. Ative-o antes de publicar.`);
    }
  }
}

/**
 * Push to Meta, then record the result.
 *
 * A failed push is stored too — as `syncError` with the old content intact —
 * so the screen can say what went wrong instead of appearing to have saved.
 */
async function syncAndStore(
  push: () => Promise<void>,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await push();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.messengerProfile.upsert({
      where: { id: PROFILE_ID },
      create: { id: PROFILE_ID, syncError: message },
      update: { syncError: message },
    });
    revalidatePath("/configuracoes");
    throw new Error(`O Instagram recusou a alteração: ${message}`);
  }

  await db.messengerProfile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID, ...data, syncedAt: new Date(), syncError: null },
    update: { ...data, syncedAt: new Date(), syncError: null },
  });

  revalidatePath("/configuracoes");
}

/**
 * "Renovar agora" on the connection tab. Forces the refresh the tick would
 * otherwise wait for; the outcome is what the page shows next.
 */
export async function refreshTokenNow() {
  const out = await maybeRefreshToken(db, new Date(), { force: true });
  revalidatePath("/configuracoes");
  revalidatePath("/", "layout");
  if (out.action === "failed") throw new Error(`A Meta recusou a renovação: ${out.error}`);
  if (out.action === "unconfigured") {
    throw new Error("Não há token para renovar: defina IG_ACCESS_TOKEN.");
  }
}

/**
 * "Inscrever esta conta" na aba de conexão.
 *
 * O passo mais fácil de esquecer do onboarding, e o único que falha em
 * silêncio: sem ele o webhook verifica com 200 e nunca chega evento. A falha
 * volta como valor — o Next troca a mensagem de um erro lançado por um digest
 * em produção, e é justamente a mensagem que diz qual das três causas é a
 * desta máquina.
 */
export async function subscribeWebhookApp(): Promise<
  { ok: true; fields: string[] } | ActionFailure
> {
  const out = await subscribeApp(db);
  if (!out.ok) return actionFailure(out.error);

  revalidatePath("/configuracoes");
  return { ok: true, fields: out.fields };
}
