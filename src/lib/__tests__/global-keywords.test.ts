import { describe, it, expect } from "vitest";
import { classifyGlobalKeyword } from "../global-keywords";

describe("classifyGlobalKeyword", () => {
  it("recognises every opt-out word, folded like a trigger would be", () => {
    for (const w of ["parar", "PARAR!", " sair ", "Stop", "cancelar", "Cancelar!!!"]) {
      expect(classifyGlobalKeyword(w), w).toBe("opt_out");
    }
  });

  it("recognises the opt-in word", () => {
    expect(classifyGlobalKeyword("voltar")).toBe("opt_in");
    expect(classifyGlobalKeyword("Voltar 🙏")).toBe("opt_in");
  });

  it("matches the whole message only — a sentence is not a command", () => {
    expect(classifyGlobalKeyword("quero parar")).toBeNull();
    expect(classifyGlobalKeyword("parar agora")).toBeNull();
    expect(classifyGlobalKeyword("não quero sair")).toBeNull();
  });

  it("ignores empty and emoji-only messages", () => {
    expect(classifyGlobalKeyword("")).toBeNull();
    expect(classifyGlobalKeyword("👋")).toBeNull();
  });
});
