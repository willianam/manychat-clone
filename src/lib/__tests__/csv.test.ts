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
