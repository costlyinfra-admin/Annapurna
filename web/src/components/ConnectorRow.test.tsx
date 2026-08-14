import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ConnectorStatus } from "../api";
import { ConnectorRow } from "./ConnectorRow";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { saveCredential: vi.fn() } };
});

// A minimal controlled harness: ConnectorRow's expand is parent-driven (accordion).
function Harness({
  overrides = {},
  onSync,
  detail,
}: {
  overrides?: Partial<ConnectorStatus>;
  onSync?: () => Promise<string>;
  detail?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
        onSync={onSync}
        detail={detail}
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
      />
    </ul>
  );
}

function row(overrides: Partial<ConnectorStatus> = {}) {
  return <Harness overrides={overrides} />;
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

  it("shows Sync now on a connected row and reports the result", async () => {
    const onSync = vi.fn().mockResolvedValue("Pulled $42 of spend.");
    render(<Harness overrides={{ connected: true }} onSync={onSync} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(onSync).toHaveBeenCalled());
    expect(await screen.findByText("Pulled $42 of spend.")).toBeInTheDocument();
  });

  it("expands a connected row's detail inline via Configure", () => {
    render(<Harness overrides={{ connected: true }} detail={<p>INLINE DETAIL</p>} />);
    expect(screen.queryByText("INLINE DETAIL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Configure/ }));
    expect(screen.getByText("INLINE DETAIL")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(screen.queryByText("INLINE DETAIL")).not.toBeInTheDocument();
  });
});
