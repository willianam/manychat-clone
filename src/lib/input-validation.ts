import { parseDate, parseNumber } from "./field-values";
import type { InputType } from "./flow-schema";

/**
 * Validation for the answers a question node collects.
 *
 * Pure, so the rules are testable without the runner. Each validator returns
 * the value in the form it should be STORED: a phone is stored as digits with
 * a leading +, a date as ISO, a number in its canonical spelling — so a later
 * condition compares what the person meant, not how they typed it.
 */

export type ValidationResult = { ok: true; value: string } | { ok: false };

/** Loose on purpose: a real mailbox check is not possible from here. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/**
 * Phones: E.164 ("+5511999998888", 8–15 digits after the +) or a Brazilian
 * number typed the usual ways ("(11) 99999-8888", "11 99999 8888",
 * "011999998888", "+55 11 9 9999-8888"). A Brazilian number is normalized to
 * E.164 with +55.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (raw.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Brazilian forms: optional 0 trunk prefix, optional 55, then DDD + 8/9 digits.
  let local = digits;
  if (local.startsWith("55") && (local.length === 12 || local.length === 13))
    local = local.slice(2);
  if (local.startsWith("0") && (local.length === 11 || local.length === 12)) local = local.slice(1);
  if (local.length !== 10 && local.length !== 11) return null;
  const ddd = Number(local.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  // A 9-digit local number is mobile and always starts with 9.
  if (local.length === 11 && local[2] !== "9") return null;
  return `+55${local}`;
}

export function validateInput(
  type: InputType | undefined,
  input: string,
  options?: string[],
): ValidationResult {
  const value = input.trim();
  switch (type ?? "text") {
    case "text":
      return value ? { ok: true, value } : { ok: false };
    case "number": {
      const n = parseNumber(value);
      return n === null ? { ok: false } : { ok: true, value: String(n) };
    }
    case "email":
      return EMAIL.test(value) ? { ok: true, value: value.toLowerCase() } : { ok: false };
    case "phone": {
      const phone = normalizePhone(value);
      return phone ? { ok: true, value: phone } : { ok: false };
    }
    case "date": {
      const t = parseDate(value);
      if (t === null) return { ok: false };
      const iso = new Date(t).toISOString();
      return { ok: true, value: /\d:\d/.test(value) ? iso : iso.slice(0, 10) };
    }
    case "option": {
      const hit = (options ?? []).find((o) => o.trim().toLowerCase() === value.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false };
    }
  }
}

/** Fallback text when the author left `validationMessage` empty. */
export function defaultValidationMessage(type: InputType | undefined): string {
  switch (type ?? "text") {
    case "number":
      return "Preciso de um número. Pode tentar de novo?";
    case "email":
      return "Esse e-mail não parece válido. Pode conferir?";
    case "phone":
      return "Esse telefone não parece válido. Manda com DDD, por favor.";
    case "date":
      return "Não entendi a data. Manda no formato dd/mm/aaaa.";
    case "option":
      return "Não entendi. Escolhe uma das opções, por favor.";
    default:
      return "Não entendi. Pode responder de novo?";
  }
}
