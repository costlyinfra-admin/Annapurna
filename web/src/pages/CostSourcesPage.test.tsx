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

  it("renders inference + build sections with their connectors and panels", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Cost sources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inference cost" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Build cost" })).toBeInTheDocument();
    // An inference connector row + the build sync controls both render.
    expect((await screen.findAllByText("Anthropic")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sync Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument(); // inference
  });

  it("syncs Claude Code spend (build) from here", async () => {
    vi.mocked(api.syncClaudeCodeSpend).mockResolvedValue({
      total: 231,
      members: 4,
      spending_members: 3,
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sync Claude Code" }));
    await waitFor(() => expect(api.syncClaudeCodeSpend).toHaveBeenCalled());
    expect(await screen.findByText(/3 of 4 developers/)).toBeInTheDocument();
  });

  it("syncs an inference provider from here", async () => {
    vi.mocked(api.ingestInference).mockResolvedValue({ total: 4200 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    await waitFor(() => expect(api.ingestInference).toHaveBeenCalledWith("anthropic", undefined));
  });
});
