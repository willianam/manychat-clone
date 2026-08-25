import { describe, it, expect } from "vitest";
import { coerceFieldValue, compareValues, parseDate, parseNumber } from "../field-values";

describe("parseNumber", () => {
  it("reads machine and Brazilian spellings alike", () => {
    expect(parseNumber("1500")).toBe(1500);
    expect(parseNumber("1500.5")).toBe(1500.5);
    expect(parseNumber("1.500,50")).toBe(1500.5);
    expect(parseNumber("1500,50")).toBe(1500.5);
    expect(parseNumber(" R$ 1.500 ")).toBe(1500);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("-3")).toBe(-3);
  });

  it("refuses what is not a number", () => {
    for (const s of ["", "abc", "12abc", "2026-08-25", "25/08/2026", "1.2.3"]) {
      expect(parseNumber(s), s).toBeNull();
    }
  });
});

describe("parseDate", () => {
  it("reads ISO and dd/mm/yyyy to the same instant", () => {
    expect(parseDate("2026-08-25")).toBe(Date.UTC(2026, 7, 25));
    expect(parseDate("25/08/2026")).toBe(Date.UTC(2026, 7, 25));
    expect(parseDate("25/08/2026 14:30")).toBe(Date.UTC(2026, 7, 25, 14, 30));
    expect(parseDate("2026-08-25T14:30")).toBe(Date.UTC(2026, 7, 25, 14, 30));
    expect(parseDate("2026-08-25T14:30:00.000Z")).toBe(Date.UTC(2026, 7, 25, 14, 30));
  });

  it("refuses impossible dates rather than rolling them over", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("amanhã")).toBeNull();
    expect(parseDate("1500")).toBeNull();
  });
});

describe("coerceFieldValue", () => {
  it("canonicalises numbers, dates and booleans", () => {
    expect(coerceFieldValue("1.500,50", "number")).toBe("1500.5");
    expect(coerceFieldValue("25/08/2026", "date")).toBe("2026-08-25");
    expect(coerceFieldValue("25/08/2026 14:30", "date")).toBe("2026-08-25T14:30:00.000Z");
    expect(coerceFieldValue("sim", "boolean")).toBe("true");
    expect(coerceFieldValue("Não", "boolean")).toBe("false");
    expect(coerceFieldValue("0", "boolean")).toBe("false");
    expect(coerceFieldValue("", "boolean")).toBe("false");
  });

  it("leaves text alone, and keeps a value that does not parse as typed", () => {
    expect(coerceFieldValue("  Ana ", "text")).toBe("  Ana ");
    expect(coerceFieldValue("muito", "number")).toBe("muito");
    expect(coerceFieldValue("depois", "date")).toBe("depois");
  });
});

describe("compareValues", () => {
  it("compares numerically when both sides are numbers", () => {
    expect(compareValues("gt", "10", "9")).toBe(true);
    expect(compareValues("lt", "10", "9")).toBe(false);
    expect(compareValues("gt", "1.500,00", "1499")).toBe(true);
  });

  it("compares as dates when both sides are dates, in either spelling", () => {
    expect(compareValues("gt", "2026-09-01", "25/08/2026")).toBe(true);
    expect(compareValues("lt", "25/08/2026", "2026-09-01")).toBe(true);
    expect(compareValues("before", "25/08/2026", "2026-09-01")).toBe(true);
    expect(compareValues("after", "25/08/2026", "2026-09-01")).toBe(false);
  });

  it("falls back to text for gt/lt, but before/after refuse non-dates", () => {
    expect(compareValues("gt", "b", "a")).toBe(true);
    expect(compareValues("lt", "10", "abc")).toBe(true); // "10" < "abc" as text
    expect(compareValues("before", "abc", "2026-09-01")).toBe(false);
    expect(compareValues("after", "2026-09-01", "")).toBe(false);
  });

  it("treats a missing value as empty text, never as zero", () => {
    // The old Number(undefined) > Number("0") path was NaN and always false;
    // now an absent field simply is not "greater than 0".
    expect(compareValues("gt", undefined, "0")).toBe(false);
    expect(compareValues("lt", undefined, "0")).toBe(true); // "" sorts before "0"
  });
});
