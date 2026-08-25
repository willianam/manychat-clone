// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { isUnsaved, setUnsaved, useUnsaved } from "../unsaved";

afterEach(() => {
  cleanup();
  setUnsaved(false);
});

describe("unsaved store", () => {
  it("starts clean and reflects the last value set", () => {
    expect(isUnsaved()).toBe(false);
    setUnsaved(true);
    expect(isUnsaved()).toBe(true);
  });

  it("re-renders subscribers when the flag flips", () => {
    const { result } = renderHook(() => useUnsaved());
    expect(result.current).toBe(false);
    act(() => setUnsaved(true));
    expect(result.current).toBe(true);
    act(() => setUnsaved(false));
    expect(result.current).toBe(false);
  });
});
