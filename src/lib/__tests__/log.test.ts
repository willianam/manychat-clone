import { describe, it, expect, vi, afterEach } from "vitest";
import { formatLine, logger } from "../log";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe("formatLine", () => {
  it("is one JSON object per line in production, with errors flattened", () => {
    process.env.NODE_ENV = "production";
    const line = formatLine("error", "webhook", "boom", { err: new Error("x"), n: 1 });
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "error", scope: "webhook", msg: "boom", n: 1 });
    expect(parsed.err).toMatchObject({ name: "Error", message: "x" });
    expect(typeof parsed.t).toBe("string");
  });

  it("is a readable line elsewhere", () => {
    process.env.NODE_ENV = "test";
    expect(formatLine("info", "worker", "started", { tickMs: 5000 })).toBe(
      '[worker] started {"tickMs":5000}',
    );
    expect(formatLine("info", "worker", "stopped")).toBe("[worker] stopped");
  });
});

describe("levels", () => {
  it("drops lines below LOG_LEVEL and routes by severity", () => {
    process.env.LOG_LEVEL = "warn";
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = logger("t");
    log.info("hidden");
    log.warn("shown");
    log.error("shown too");

    expect(out).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
