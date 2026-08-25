import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_LIMIT, emptyHistory, record, redo, undo } from "../flow-history";

describe("flow history", () => {
  it("undo returns the state before the last change, redo brings it back", () => {
    let h = emptyHistory<string>();
    h = record(h, "a");
    h = record(h, "b");
    const u = undo(h, "c")!;
    expect(u.state).toBe("b");
    const u2 = undo(u.history, u.state)!;
    expect(u2.state).toBe("a");
    const r = redo(u2.history, u2.state)!;
    expect(r.state).toBe("b");
    expect(undo(emptyHistory<string>(), "x")).toBeNull();
    expect(redo(h, "x")).toBeNull();
  });

  it("coalesces changes with the same key inside the window", () => {
    let h = emptyHistory<string>();
    h = record(h, "Ol", "data:n1", 1000);
    h = record(h, "Olá", "data:n1", 1200);
    h = record(h, "Olá!", "data:n1", 1300);
    expect(h.past).toEqual(["Ol"]);
    // A different key, or a pause, starts a new entry.
    h = record(h, "x", "data:n2", 1400);
    h = record(h, "y", "data:n2", 1400 + COALESCE_MS + 1);
    expect(h.past).toEqual(["Ol", "x", "y"]);
  });

  it("a new change after undo clears redo", () => {
    let h = emptyHistory<string>();
    h = record(h, "a");
    const u = undo(h, "b")!;
    expect(u.history.future).toEqual(["b"]);
    const h2 = record(u.history, "a2");
    expect(h2.future).toEqual([]);
  });

  it("keeps at most HISTORY_LIMIT snapshots", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, i, null, i * 10_000);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });
});
