import { describe, it, expect } from "vitest";
import { validateInput, normalizePhone, defaultValidationMessage } from "../input-validation";

describe("validateInput", () => {
  it("text accepts anything non-empty, trimmed", () => {
    expect(validateInput("text", "  Ana ")).toEqual({ ok: true, value: "Ana" });
    expect(validateInput(undefined, "   ")).toEqual({ ok: false });
  });

  it("number stores the canonical spelling", () => {
    expect(validateInput("number", "1.500,50")).toEqual({ ok: true, value: "1500.5" });
    expect(validateInput("number", "abc")).toEqual({ ok: false });
  });

  it("email is loose but rejects the obvious", () => {
    expect(validateInput("email", "Ana@Exemplo.com")).toEqual({
      ok: true,
      value: "ana@exemplo.com",
    });
    expect(validateInput("email", "ana@exemplo")).toEqual({ ok: false });
    expect(validateInput("email", "sem arroba")).toEqual({ ok: false });
  });

  it("date accepts dd/mm/aaaa and ISO, stores ISO", () => {
    expect(validateInput("date", "25/08/2026")).toEqual({ ok: true, value: "2026-08-25" });
    expect(validateInput("date", "2026-08-25")).toEqual({ ok: true, value: "2026-08-25" });
    expect(validateInput("date", "31/02/2026")).toEqual({ ok: false });
    expect(validateInput("date", "amanhã")).toEqual({ ok: false });
  });

  it("option matches by title, case-insensitive, and stores the canonical title", () => {
    expect(validateInput("option", "sim", ["Sim", "Não"])).toEqual({ ok: true, value: "Sim" });
    expect(validateInput("option", "talvez", ["Sim", "Não"])).toEqual({ ok: false });
  });
});

describe("normalizePhone", () => {
  it("accepts E.164 as is", () => {
    expect(normalizePhone("+5511999998888")).toBe("+5511999998888");
    expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671");
  });

  it("normalizes Brazilian spellings to +55", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("+5511999998888");
    expect(normalizePhone("11 3333-4444")).toBe("+551133334444");
    expect(normalizePhone("011 99999 8888")).toBe("+5511999998888");
    expect(normalizePhone("55 11 99999-8888")).toBe("+5511999998888");
  });

  it("rejects junk", () => {
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("11 8888-77777")).toBeNull(); // 11 digits not starting with 9
    expect(normalizePhone("+12")).toBeNull();
    expect(normalizePhone("oi")).toBeNull();
  });
});

describe("defaultValidationMessage", () => {
  it("has a message for every type", () => {
    for (const t of ["text", "number", "email", "phone", "date", "option"] as const) {
      expect(defaultValidationMessage(t).length).toBeGreaterThan(5);
    }
  });
});
