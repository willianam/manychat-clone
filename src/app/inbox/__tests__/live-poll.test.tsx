// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LivePoll } from "../LivePoll";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockClear();
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("LivePoll", () => {
  it("refreshes on the interval only while the tab is visible, and once on return", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    render(<LivePoll intervalMs={1000} />);

    act(() => vi.advanceTimersByTime(2500));
    expect(refresh).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    act(() => vi.advanceTimersByTime(3000));
    expect(refresh).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops on unmount", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const { unmount } = render(<LivePoll intervalMs={1000} />);
    unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
