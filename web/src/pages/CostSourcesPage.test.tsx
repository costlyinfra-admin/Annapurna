import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { CostSourcesPage } from "./CostSourcesPage";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      connectors: vi.fn(),
      listFeatures: vi.fn(),
      listComputePools: vi.fn(),
      listSeatSources: vi.fn(),
      ingestInference: vi.fn(),
      syncClaudeCodeSpend: vi.fn(),
      syncCopilotSeats: vi.fn(),
      syncCursorSpend: vi.fn(),
      createComputePool: vi.fn(),
      saveCredential: vi.fn(),
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CostSourcesPage />
    </MemoryRouter>,
  );
}

describe("CostSourcesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "anthropic", name: "Anthropic", category: "inference", connected: false },
    ]);
    vi.mocked(api.listFeatures).mockResolvedValue([]);
    vi.mocked(api.listComputePools).mockResolvedValue([]);
    vi.mocked(api.listSeatSources).mockResolvedValue([]);
  });

  it("renders inference, self-hosted, and build sections with their panels", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Cost sources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inference cost" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Self-hosted models" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Build cost" })).toBeInTheDocument();
    // An inference connector row, the self-hosted pool form, and the build sync
    // controls all render.
    expect((await screen.findAllByText("Anthropic")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save pool" })).toBeInTheDocument();
    // Build cost is now a list of collapsible method cards; the forms inside
    // them stay hidden until a card is expanded.
    expect(screen.getByRole("button", { name: /Usage-based tools/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub Copilot/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Claude Code" })).not.toBeInTheDocument();
    // The old standalone "Sync inference" dropdown is gone.
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("syncs Claude Code spend after opening the usage-based card", async () => {
    vi.mocked(api.syncClaudeCodeSpend).mockResolvedValue({
      total: 231,
      members: 4,
      spending_members: 3,
    });
    renderPage();
    // Expand the "Usage-based tools" method card, then sync.
    fireEvent.click(await screen.findByRole("button", { name: /Usage-based tools/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sync Claude Code" }));
    await waitFor(() => expect(api.syncClaudeCodeSpend).toHaveBeenCalled());
    expect(await screen.findByText(/3 of 4 developers/)).toBeInTheDocument();
  });

  it("pulls a connected provider's bill via Sync now", async () => {
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "anthropic", name: "Anthropic", category: "inference", connected: true },
    ]);
    vi.mocked(api.ingestInference).mockResolvedValue({ total: 4200 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.ingestInference).toHaveBeenCalledWith("anthropic"));
    expect(await screen.findByText(/Pulled .* of Anthropic spend/)).toBeInTheDocument();
  });
});
