/**
 * The /me/messenger_profile half of the Instagram API.
 *
 * Kept out of instagram.ts because it is a different kind of call: it
 * configures the account rather than sending to a contact, so none of the
 * messaging-window machinery applies.
 *
 * Endpoint verified against developers.facebook.com/docs/messenger-platform/
 * instagram/features/ice-breakers and .../persistent-menu (v26.0).
 */

import {
  buildIceBreakersBody,
  buildPersistentMenuBody,
  type IceBreakerInput,
  type MenuItemInput,
} from "../lib/messenger-profile";

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v26.0";
const BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const SELF = process.env.IG_USER_ID ?? "me";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${requireEnv("IG_ACCESS_TOKEN")}`,
  };
}

async function postProfile(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/${SELF}/messenger_profile`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(parsed.error?.message ?? `Instagram API retornou ${res.status}`);
  }
}

/**
 * Delete a profile field.
 *
 * Meta has no "empty list" for these: posting `call_to_actions: []` is a
 * validation error, so clearing the ice breakers means DELETE with the field
 * name. Without this, removing the last question would silently leave the
 * old set live on the account.
 */
async function deleteProfileFields(fields: string[]): Promise<void> {
  const res = await fetch(`${BASE}/${SELF}/messenger_profile`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ platform: "instagram", fields }),
  });
  const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  // Deleting something that was never set is not an error worth surfacing.
  if (!res.ok && !/does not exist|not set/i.test(parsed.error?.message ?? "")) {
    throw new Error(parsed.error?.message ?? `Instagram API retornou ${res.status}`);
  }
}

export async function pushIceBreakers(items: IceBreakerInput[]): Promise<void> {
  if (items.length === 0) return deleteProfileFields(["ice_breakers"]);
  return postProfile(buildIceBreakersBody(items));
}

export async function pushPersistentMenu(items: MenuItemInput[]): Promise<void> {
  if (items.length === 0) return deleteProfileFields(["persistent_menu"]);
  return postProfile(buildPersistentMenuBody(items));
}
