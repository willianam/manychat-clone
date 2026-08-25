import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, serializeCsv } from "../csv";

describe("csv", () => {
  it("round-trips quotes, commas, newlines and accents", () => {
    const rows = [
      ["a", "b,c", 'say "hi"', "line\nbreak", "São Paulo"],
      ["", "x", "", "", ""],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });

  it("neutralises cells a spreadsheet would run as a formula", () => {
    // An Instagram display name is attacker-chosen and lands in the
    // operator's spreadsheet; without the prefix these execute on open.
    const out = serializeCsv([['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)"]]);
    for (const cell of ["'=HYPERLINK", "'+1+1", "'-2+3", "'@SUM(A1)"]) {
      expect(out).toContain(cell);
    }
  });

  it("leaves ordinary values, including inner symbols, alone", () => {
    // Only a LEADING trigger character matters.
    expect(serializeCsv([["ana", "a=b", "3-4"]])).toBe("ana,a=b,3-4\r\n");
  });

  it("puts the escape inside the quotes when the cell also needs quoting", () => {
    expect(serializeCsv([["=a,b"]])).toBe('"\'=a,b"\r\n');
  });
  it("parses \\r\\n and a BOM, drops the trailing blank line", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parseCsvRecords keys rows by header and pads short rows", () => {
    expect(parseCsvRecords("k, v\n1\n2,b")).toEqual([
      { k: "1", v: "" },
      { k: "2", v: "b" },
    ]);
    expect(parseCsvRecords("")).toEqual([]);
  });
});
