import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ConnectorStatus } from "../api";
import { ConnectorRow } from "./ConnectorRow";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { saveCredential: vi.fn() } };
});

function row(overrides: Partial<ConnectorStatus> = {}) {
  return (
    <ul>
      <ConnectorRow
        connector={{
          type: "anthropic",
          name: "Anthropic",
          category: "inference",
          connected: false,
          ...overrides,
        }}
        onConnected={vi.fn()}
      />
    </ul>
  );
}

describe("ConnectorRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides the instructions until Connect is pressed", () => {
    render(row());
    expect(screen.queryByText(/organization Cost & Usage report/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    // Source-specific guide + a setup link appear underneath the row.
    expect(screen.getByText(/organization Cost & Usage report/)).toBeInTheDocument();
    expect(screen.getByText(/create an Admin API key/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open provider setup page/ })).toHaveAttribute(
      "href",
      "https://console.anthropic.com/settings/admin-keys",
    );
  });

  it("saves the pasted credential and collapses", async () => {
    vi.mocked(api.saveCredential).mockResolvedValue(undefined);
    render(row());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.change(screen.getByLabelText("Anthropic token"), {
      target: { value: "sk-ant-admin-xyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.saveCredential).toHaveBeenCalledWith("anthropic", "sk-ant-admin-xyz"),
    );
  });

  it("uses a JSON textarea for Bedrock", () => {
    render(row({ type: "bedrock", name: "Amazon Bedrock (AWS cost)" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const field = screen.getByLabelText("Amazon Bedrock (AWS cost) credentials");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("placeholder", expect.stringContaining("access_key_id"));
  });
});
