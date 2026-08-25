// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";
import { NOW, h, message } from "./fixtures";

afterEach(cleanup);

describe("MessageBubble", () => {
  it("puts inbound on the left without a status and outbound on the right with one", () => {
    const { container } = render(
      <>
        <MessageBubble message={message({ text: "oi" })} now={NOW} />
        <MessageBubble
          message={message({ direction: "OUTBOUND", status: "READ", text: "olá" })}
          now={NOW}
        />
      </>,
    );
    const [inb, out] = Array.from(container.querySelectorAll("[data-direction]"));
    expect(inb!.className).toContain("justify-start");
    expect(out!.className).toContain("justify-end");
    expect(screen.getByText("· lido")).toBeTruthy();
    expect(screen.queryByText("· entregue")).toBeNull();
  });

  it("shows the failure reason under a failed send", () => {
    render(
      <MessageBubble
        message={message({
          direction: "OUTBOUND",
          status: "FAILED",
          text: "x",
          error: "Outside the 24h messaging window",
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("· falhou")).toBeTruthy();
    expect(screen.getByText("Outside the 24h messaging window")).toBeTruthy();
  });

  it("renders inbound attachments with their expiry, and no link once expired", () => {
    const fresh = {
      type: "image",
      url: "https://cdn/x.jpg",
      capturedAt: h(24).toISOString(),
      expiresAt: h(-5 * 24).toISOString(),
    };
    const dying = {
      type: "file",
      url: "https://cdn/doc.pdf",
      title: "doc.pdf",
      capturedAt: h(6 * 24).toISOString(),
      expiresAt: h(-24).toISOString(),
    };
    const dead = {
      type: "audio",
      url: "https://cdn/a.mp4",
      capturedAt: h(9 * 24).toISOString(),
      expiresAt: h(2 * 24).toISOString(),
    };
    render(
      <MessageBubble
        message={message({ text: "[3 anexos]", payload: { attachments: [fresh, dying, dead] } })}
        now={NOW}
      />,
    );
    expect(screen.getByRole("img", { name: "Imagem recebida" }).getAttribute("src")).toBe(
      "https://cdn/x.jpg",
    );
    expect(screen.getByText("expira em 5 dias")).toBeTruthy();
    expect(screen.getByRole("link", { name: "doc.pdf" }).getAttribute("href")).toBe(
      "https://cdn/doc.pdf",
    );
    expect(screen.getByText("expira amanhã")).toBeTruthy();
    expect(screen.getByText("link expirado")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "áudio" })).toBeNull();
    // The "[3 anexos]" placeholder is not repeated as text next to the real attachments.
    expect(screen.queryByText("[3 anexos]")).toBeNull();
  });
});
