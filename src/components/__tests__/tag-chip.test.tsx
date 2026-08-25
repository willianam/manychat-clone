// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { TagChip } from "../ui/tag-chip";

describe("TagChip", () => {
  it("paints the background and picks dark text on a pale color", () => {
    render(<TagChip name="lead" color="#fde047" />);
    const chip = screen.getByText("lead");
    expect(chip.style.backgroundColor).toBe("rgb(253, 224, 71)");
    expect(chip.style.color).toBe("rgb(23, 23, 23)");
  });

  it("picks light text on a dark color", () => {
    render(<TagChip name="vip" color="#312e81" />);
    expect(screen.getByText("vip").style.color).toBe("rgb(255, 255, 255)");
  });

  it("shows the color as a dot when not selected", () => {
    const { container } = render(<TagChip name="frio" color="#0ea5e9" selected={false} />);
    const chip = screen.getByText("frio");
    expect(chip.style.backgroundColor).toBe("");
    const dot = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(14, 165, 233)");
  });
});
