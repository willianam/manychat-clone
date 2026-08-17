import { describe, it, expect } from "vitest";
import { interpolate, loadContactFields } from "../flow-runner";

describe("interpolate", () => {
  it("substitutes a value that is present", () => {
    expect(interpolate("Oi {{nome}}!", { nome: "Ana" })).toBe("Oi Ana!");
  });

  it("uses the default when the key is absent", () => {
    expect(interpolate("Oi {{nome|amigo}}!", {})).toBe("Oi amigo!");
  });

  it("prefers the real value over the default", () => {
    expect(interpolate("Oi {{nome|amigo}}!", { nome: "Ana" })).toBe("Oi Ana!");
  });

  it("renders empty for a missing key with no default", () => {
    expect(interpolate("Oi {{nome}}!", {})).toBe("Oi !");
  });

  it("treats null, undefined and empty string as missing", () => {
    expect(interpolate("{{n|x}}", { n: null })).toBe("x");
    expect(interpolate("{{n|x}}", { n: undefined })).toBe("x");
    expect(interpolate("{{n|x}}", { n: "" })).toBe("x");
  });

  it("allows spaces and punctuation inside the default", () => {
    expect(interpolate("Oi {{nome|meu amigo}}!", {})).toBe("Oi meu amigo!");
    expect(interpolate("{{saudacao|bom dia, tudo bem}}", {})).toBe("bom dia, tudo bem");
  });

  it("supports an explicitly empty default", () => {
    expect(interpolate("Oi{{nome|}}!", {})).toBe("Oi!");
  });

  it("tolerates whitespace around the key", () => {
    expect(interpolate("{{ nome }}", { nome: "Ana" })).toBe("Ana");
    expect(interpolate("{{ nome |amigo}}", {})).toBe("amigo");
  });

  it("substitutes several placeholders independently", () => {
    expect(interpolate("{{a}} e {{b|dois}} e {{c}}", { a: "um", c: "tres" })).toBe(
      "um e dois e tres",
    );
  });

  it("stringifies non-string values", () => {
    expect(interpolate("{{n}}", { n: 42 })).toBe("42");
    expect(interpolate("{{n|x}}", { n: 0 })).toBe("0");
    expect(interpolate("{{n|x}}", { n: false })).toBe("false");
  });

  it("leaves text without placeholders untouched", () => {
    expect(interpolate("nada aqui", { nome: "Ana" })).toBe("nada aqui");
  });

  it("ignores malformed placeholders rather than mangling them", () => {
    expect(interpolate("{{ }}", {})).toBe("{{ }}");
    expect(interpolate("{{1nome}}", {})).toBe("{{1nome}}");
    expect(interpolate("{single}", {})).toBe("{single}");
  });

  it("does not recursively expand a substituted value", () => {
    // A user-supplied answer containing braces must not become a template.
    expect(interpolate("{{a}}", { a: "{{b}}", b: "boom" })).toBe("{{b}}");
  });
});

describe("loadContactFields", () => {
  const fakeDb = (rows: { key: string; value: string }[]) =>
    ({ contactField: { findMany: async () => rows } }) as never;

  it("makes stored fields readable by interpolate", async () => {
    const ctx = await loadContactFields(fakeDb([{ key: "nome", value: "Ana" }]), "c1", {});
    expect(interpolate("Oi {{nome|amigo}}!", ctx)).toBe("Oi Ana!");
  });

  it("lets the session context win over a stored field", async () => {
    const ctx = await loadContactFields(fakeDb([{ key: "nome", value: "Antigo" }]), "c1", {
      nome: "Novo",
    });
    expect(ctx.nome).toBe("Novo");
  });

  it("falls back to the default when neither source has the key", async () => {
    const ctx = await loadContactFields(fakeDb([]), "c1", {});
    expect(interpolate("Oi {{nome|amigo}}!", ctx)).toBe("Oi amigo!");
  });
});
