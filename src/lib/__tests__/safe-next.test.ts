import { describe, it, expect } from "vitest";
import { safeNext } from "../../app/login/safe-next";

describe("safeNext", () => {
  it("keeps an internal path, query and hash included", () => {
    expect(safeNext("/contacts/abc?tab=notas#topo")).toBe("/contacts/abc?tab=notas#topo");
    expect(safeNext("/")).toBe("/");
  });

  it("refuses an absolute URL to another origin", () => {
    // The phishing case: real domain, real login, fake panel afterwards.
    expect(safeNext("https://painel-falso.example/login")).toBe("/");
    expect(safeNext("http://evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });

  it("refuses protocol-relative paths, which browsers treat as external", () => {
    expect(safeNext("//evil.example/login")).toBe("/");
    expect(safeNext("/\\evil.example/login")).toBe("/");
  });

  it("falls back to the root for missing or empty input", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});
