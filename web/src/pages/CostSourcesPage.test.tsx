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
      sourceDetail: vi.fn(),
      classifyResource: vi.fn(),
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

  it("splits sources into tabs; Inference is the default", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Cost sources" })).toBeInTheDocument();
    // Three tabs, Inference active by default with its connector list shown.
    expect(screen.getByRole("tab", { name: "Inference cost" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Self-hosted models" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Build cost" })).toBeInTheDocument();
    expect((await screen.findAllByText("Anthropic")).length).toBeGreaterThan(0);
    // Other tabs' panels are not mounted until selected.
    expect(screen.queryByRole("button", { name: "Save pool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usage-based tools/ })).not.toBeInTheDocument();

    // Self-hosted tab shows the pool form.
    fireEvent.click(screen.getByRole("tab", { name: "Self-hosted models" }));
    expect(await screen.findByRole("button", { name: "Save pool" })).toBeInTheDocument();

    // Build tab shows the collapsible method cards (forms hidden until expanded).
    fireEvent.click(screen.getByRole("tab", { name: "Build cost" }));
    expect(screen.getByRole("button", { name: /Usage-based tools/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub Copilot/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Claude Code" })).not.toBeInTheDocument();
  });

  it("syncs Claude Code spend from the Build tab's usage-based card", async () => {
    vi.mocked(api.syncClaudeCodeSpend).mockResolvedValue({
      total: 231,
      members: 4,
      spending_members: 3,
    });
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Build cost" }));
    // Expand the "Usage-based tools" method card, then sync.
    fireEvent.click(screen.getByRole("button", { name: /Usage-based tools/ }));
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
    // Sync now backfills the last 12 months of history.
    await waitFor(() =>
      expect(api.ingestInference).toHaveBeenCalledWith("anthropic", undefined, 12),
    );
    expect(await screen.findByText(/Pulled .* of Anthropic spend/)).toBeInTheDocument();
  });

  it("expands a connected source's detail inline and classifies a resource", async () => {
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "anthropic", name: "Anthropic", category: "inference", connected: true },
    ]);
    vi.mocked(api.sourceDetail).mockResolvedValue({
      provider: "anthropic",
      classifiable: true,
      columns: { group: "Workspace", name: "API key" },
      rows: [
        {
          resource_type: "api_key",
          resource_id: "k_a",
          name: "service-a-prod",
          group: "mcs-dev",
          classification: "unclassified",
          cost: 100,
        },
      ],
    });
    vi.mocked(api.classifyResource).mockResolvedValue({ classification: "production" });
    renderPage();

    // Detail is hidden until the source is expanded.
    expect(screen.queryByText("service-a-prod")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Configure/ }));

    // Detail appears inline: one table, no KPI tiles, no auto-classification.
    expect(await screen.findByText("service-a-prod")).toBeInTheDocument();
    expect(screen.queryByText("Production inference")).not.toBeInTheDocument();
    const select = screen.getByLabelText(/Classification for service-a-prod/);
    expect(select).toHaveValue("unclassified");

    // Classifying calls the API with the user's choice.
    fireEvent.change(select, { target: { value: "production" } });
    await waitFor(() =>
      expect(api.classifyResource).toHaveBeenCalledWith("anthropic", {
        resource_type: "api_key",
        resource_id: "k_a",
        classification: "production",
      }),
    );
  });
});
