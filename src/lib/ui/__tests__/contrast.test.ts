import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, readableTextColor, relativeLuminance } from "../contrast";

describe("contrast", () => {
  it("parses short and long hex, with or without #", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("000000")).toEqual([0, 0, 0]);
    expect(parseHex("#6366f1")).toEqual([99, 102, 241]);
    expect(parseHex("red")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });

  it("computes WCAG luminance at the extremes", () => {
    expect(relativeLuminance("#000")).toBe(0);
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("nope")).toBeNull();
  });

  it("black on white is the maximum 21:1 ratio", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 1);
  });

  it("picks dark text on light backgrounds and light text on dark ones", () => {
    expect(readableTextColor("#fde047")).toBe("#171717"); // yellow-300
    expect(readableTextColor("#ffffff")).toBe("#171717");
    expect(readableTextColor("#1e1b4b")).toBe("#ffffff"); // indigo-950
    expect(readableTextColor("#6366f1")).toBe("#ffffff"); // indigo-500
  });

  it("falls back to dark text when the color cannot be parsed", () => {
    expect(readableTextColor("rgb(1,2,3)")).toBe("#171717");
  });
});
