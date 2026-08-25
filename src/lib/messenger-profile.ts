/**
 * Ice breakers and persistent menu — the two things that decide whether a
 * conversation starts at all.
 *
 * Shapes verified against
 * developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers
 * and .../features/persistent-menu (Instagram, v26.0):
 *
 *   POST /me/messenger_profile
 *   { "platform": "instagram",
 *     "ice_breakers": [{ "locale": "default",
 *                        "call_to_actions": [{ "question", "payload" }] }] }
 *
 *   POST /me/messenger_profile
 *   { "platform": "instagram",
 *     "persistent_menu": [{ "locale": "default",
 *                           "call_to_actions": [{ "type": "postback",
 *                                                 "title", "payload" }] }] }
 *
 * Instagram-specific: `composer_input_disabled` and `webview_height_ratio`
 * are NOT supported and are never sent. Only `postback` and `web_url` items
 * are accepted in the menu.
 */

import { z } from "zod";

/**
 * Meta's documented limits. Ice breakers cap at 4 questions; the question and
 * payload caps are the Messenger Platform values, which Instagram inherits.
 * The menu has no hard server limit but Meta recommends 5 — we enforce it,
 * since a menu longer than the sheet is a menu with invisible items.
 */
export const PROFILE_LIMITS = {
  iceBreakers: 4,
  iceBreakerQuestion: 80,
  menuItems: 5,
  menuTitle: 30,
  payload: 1000,
} as const;

/** One ice breaker as edited in our UI: a question pointing at a flow. */
export const IceBreakerInput = z.object({
  question: z
    .string()
    .trim()
    .min(1, "A pergunta não pode ficar vazia.")
    .max(
      PROFILE_LIMITS.iceBreakerQuestion,
      `A pergunta pode ter no máximo ${PROFILE_LIMITS.iceBreakerQuestion} caracteres.`,
    ),
  flowId: z.string().min(1, "Escolha um fluxo para esta pergunta."),
});
export type IceBreakerInput = z.infer<typeof IceBreakerInput>;

export const IceBreakersInput = z
  .array(IceBreakerInput)
  .max(PROFILE_LIMITS.iceBreakers, `No máximo ${PROFILE_LIMITS.iceBreakers} perguntas.`)
  .superRefine((items, ctx) => {
    // Two identical questions render as two identical chips: the user cannot
    // tell them apart, and whichever they tap is a coin flip.
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const key = item.question.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "question"],
          message: "Essa pergunta está repetida.",
        });
      }
      seen.add(key);
    });
  });

/** One persistent-menu item: either a flow (postback) or an external link. */
export const MenuItemInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("postback"),
    title: z
      .string()
      .trim()
      .min(1, "O título não pode ficar vazio.")
      .max(
        PROFILE_LIMITS.menuTitle,
        `O título pode ter no máximo ${PROFILE_LIMITS.menuTitle} caracteres.`,
      ),
    flowId: z.string().min(1, "Escolha um fluxo para este item."),
  }),
  z.object({
    type: z.literal("web_url"),
    title: z
      .string()
      .trim()
      .min(1, "O título não pode ficar vazio.")
      .max(
        PROFILE_LIMITS.menuTitle,
        `O título pode ter no máximo ${PROFILE_LIMITS.menuTitle} caracteres.`,
      ),
    // Meta rejects a non-https url outright, so catch it before the API call.
    url: z
      .string()
      .trim()
      .url("Informe uma URL válida.")
      .startsWith("https://", "A URL precisa começar com https://"),
  }),
]);
export type MenuItemInput = z.infer<typeof MenuItemInput>;

export const MenuItemsInput = z
  .array(MenuItemInput)
  .max(PROFILE_LIMITS.menuItems, `No máximo ${PROFILE_LIMITS.menuItems} itens no menu.`);

/**
 * The payload string that routes a tap back to a flow.
 *
 * Prefixed so trigger-dispatch can tell a profile tap from a flow button
 * payload, which names a node inside a running session and means something
 * entirely different.
 */
export const PROFILE_PAYLOAD_PREFIX = "FLOW:";

export function flowPayload(flowId: string): string {
  return `${PROFILE_PAYLOAD_PREFIX}${flowId}`;
}

/** The flow id inside a profile payload, or null if it isn't one. */
export function parseFlowPayload(payload: string): string | null {
  if (!payload.startsWith(PROFILE_PAYLOAD_PREFIX)) return null;
  const id = payload.slice(PROFILE_PAYLOAD_PREFIX.length).trim();
  return id || null;
}

/** The exact body Meta expects for ice breakers. */
export function buildIceBreakersBody(items: IceBreakerInput[]): Record<string, unknown> {
  return {
    platform: "instagram",
    ice_breakers: [
      {
        locale: "default",
        call_to_actions: items.map((i) => ({
          question: i.question,
          payload: flowPayload(i.flowId),
        })),
      },
    ],
  };
}

/** The exact body Meta expects for the persistent menu. */
export function buildPersistentMenuBody(items: MenuItemInput[]): Record<string, unknown> {
  return {
    platform: "instagram",
    persistent_menu: [
      {
        locale: "default",
        call_to_actions: items.map((i) =>
          i.type === "web_url"
            ? { type: "web_url", title: i.title, url: i.url }
            : { type: "postback", title: i.title, payload: flowPayload(i.flowId) },
        ),
      },
    ],
  };
}
