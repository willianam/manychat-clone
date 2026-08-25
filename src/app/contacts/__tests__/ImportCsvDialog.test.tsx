// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  previewImport: vi.fn(async () => ({
    total: 3,
    updated: 2,
    skipped: ["999"],
    unknownColumns: ["extra"],
  })),
  applyImport: vi.fn(async () => ({ total: 3, updated: 2, skipped: ["999"], unknownColumns: [] })),
}));
vi.mock("../import-actions", () => actions);

import { ImportCsvDialog } from "../ImportCsvDialog";

const CSV = "igScopedId,name,extra\n111,Ana,x\n222,Bia,y\n999,Zé,z\n";

function pickFile() {
  const input = screen.getByLabelText("Arquivo") as HTMLInputElement;
  const file = new File([CSV], "contatos.csv", { type: "text/csv" });
  // jsdom's File lacks text(); the component reads through it.
  Object.defineProperty(file, "text", { value: async () => CSV });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportCsvDialog", () => {
  it("previews the file before offering to apply", async () => {
    render(<ImportCsvDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Importar CSV" }));
    const apply = screen.getByRole("button", { name: "Aplicar importação" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    pickFile();
    await waitFor(() => expect(actions.previewImport).toHaveBeenCalledWith(CSV));
    await waitFor(() => expect(screen.getByText(/seria\(m\) atualizada\(s\)/)).toBeTruthy());
    expect(screen.getByText(/Ignoradas: 999/)).toBeTruthy();
    expect(screen.getByText(/Colunas desconhecidas \(ignoradas\): extra/)).toBeTruthy();
    expect(actions.applyImport).not.toHaveBeenCalled();
    await waitFor(() => expect(apply.disabled).toBe(false));
  });

  it("applies the same text it previewed, then closes and refreshes", async () => {
    render(<ImportCsvDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Importar CSV" }));
    pickFile();
    const apply = screen.getByRole("button", { name: "Aplicar importação" }) as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(actions.applyImport).toHaveBeenCalledWith(CSV));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
