// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { isActive, isBareRoute, titleFor } from "../shell/nav";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: () => {} }),
}));

import { SidebarNav } from "../shell/sidebar-nav";

describe("nav helpers", () => {
  it("matches the home link only on /", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/flows")).toBe(false);
  });

  it("matches a section and its subtree", () => {
    expect(isActive("/flows", "/flows")).toBe(true);
    expect(isActive("/flows", "/flows/abc/preview")).toBe(true);
    expect(isActive("/flows", "/flowsx")).toBe(false);
  });

  it("titles the header after the active section", () => {
    expect(titleFor("/gatilhos")).toBe("Gatilhos");
    expect(titleFor("/flows/abc")).toBe("Fluxos");
    expect(titleFor("/nada")).toBe("ManyChat Clone");
  });

  it("keeps login and privacy bare", () => {
    expect(isBareRoute("/login")).toBe(true);
    expect(isBareRoute("/privacidade")).toBe(true);
    expect(isBareRoute("/")).toBe(false);
  });
});

describe("SidebarNav", () => {
  it("marks the current route with aria-current", () => {
    pathname.current = "/flows/abc";
    render(<SidebarNav />);
    const active = screen.getByRole("link", { name: "Fluxos" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Início" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(12);
  });

  it("shows the unread badge on the inbox item only when there is something unread", () => {
    pathname.current = "/";
    render(<SidebarNav badges={{ "/inbox": 3 }} />);
    const inbox = screen.getByRole("link", { name: /Caixa de entrada/ });
    expect(inbox.textContent).toContain("3");
    expect(screen.getByLabelText("3 conversas não lidas")).toBeTruthy();
    cleanup();
    render(<SidebarNav badges={{ "/inbox": 0 }} />);
    expect(screen.queryByLabelText(/não lida/)).toBeNull();
  });

  it("titles the inbox route", () => {
    expect(titleFor("/inbox")).toBe("Caixa de entrada");
  });
});
