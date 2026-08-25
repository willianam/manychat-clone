// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  setField: vi.fn(async (_c: string, _k: string, v: string) => v.trim()),
  unsetField: vi.fn(async () => undefined),
}));
vi.mock("../actions", () => actions);

import { FieldsEditor } from "../FieldsEditor";

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

const fields = [
  { key: "cidade", label: "Cidade", type: "TEXT" as const, defaultValue: null },
  { key: "total", label: "Total", type: "NUMBER" as const, defaultValue: "0" },
  { key: "nasc", label: "Nascimento", type: "DATE" as const, defaultValue: null },
  { key: "vip", label: "VIP", type: "BOOLEAN" as const, defaultValue: null },
];

describe("FieldsEditor", () => {
  it("renders an input typed after each field's registry entry", () => {
    render(
      <FieldsEditor contactId="c1" fields={fields} values={{ cidade: "SP", nasc: "1990-05-20" }} />,
    );
    expect(byId("field-cidade").type).toBe("text");
    expect(byId("field-total").type).toBe("number");
    const date = byId("field-nasc");
    expect(date.type).toBe("date");
    expect(date.value).toBe("1990-05-20");
    // Boolean is a select, exposed as a combobox.
    expect(screen.getByRole("combobox", { name: /VIP/ })).toBeTruthy();
  });

  it("saves on blur and shows the value the server kept", async () => {
    render(<FieldsEditor contactId="c1" fields={fields} values={{}} />);
    const cidade = byId("field-cidade");
    fireEvent.change(cidade, { target: { value: "  Recife " } });
    fireEvent.blur(cidade);
    await waitFor(() => expect(actions.setField).toHaveBeenCalledWith("c1", "cidade", "  Recife "));
    await waitFor(() => expect(cidade.value).toBe("Recife"));
    expect(refresh).toHaveBeenCalled();
  });

  it("does not save when the value did not change", () => {
    render(<FieldsEditor contactId="c1" fields={fields} values={{ cidade: "SP" }} />);
    fireEvent.blur(byId("field-cidade"));
    expect(actions.setField).not.toHaveBeenCalledWith("c1", "cidade", "SP");
  });

  it("offers a clear button only for fields with a value", async () => {
    render(<FieldsEditor contactId="c1" fields={fields} values={{ cidade: "SP" }} />);
    expect(screen.queryByRole("button", { name: "Limpar Total" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Limpar Cidade" }));
    await waitFor(() => expect(actions.unsetField).toHaveBeenCalledWith("c1", "cidade"));
  });

  it("explains an empty registry", () => {
    render(<FieldsEditor contactId="c1" fields={[]} values={{}} />);
    expect(screen.getByText(/Nenhum campo registrado/)).toBeTruthy();
  });
});
