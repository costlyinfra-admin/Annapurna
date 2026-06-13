import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { Onboarding } from "./Onboarding";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      connectors: vi.fn(),
      saveCredential: vi.fn(),
      logout: vi.fn(),
      listFeatures: vi.fn(),
      runDiscovery: vi.fn(),
      confirmOnboarding: vi.fn(),
      listSeatSources: vi.fn(),
      listComputePools: vi.fn(),
    },
  };
});

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Onboarding />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Onboarding wizard shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "github", name: "GitHub", category: "features", connected: false },
      { type: "anthropic", name: "Anthropic", category: "inference", connected: false },
    ]);
    vi.mocked(api.listFeatures).mockResolvedValue([]); // empty states
    vi.mocked(api.listSeatSources).mockResolvedValue([]);
    vi.mocked(api.listComputePools).mockResolvedValue([]);
  });

  it("walks Features -> Build -> Inference -> Confirm and back", async () => {
    renderOnboarding();

    // Step 1: Identify features — GitHub connect + discovery/curation together.
    expect(await screen.findByRole("heading", { name: "Identify features" })).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Review auto-discovered features" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No features discovered yet")).toBeInTheDocument();

    // Step 2: Build cost sources — embedded sync panels.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Build cost sources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync spend" })).toBeInTheDocument(); // Cursor
    expect(screen.getByPlaceholderText("GitHub organization")).toBeInTheDocument(); // Copilot

    // Step 3: Inference cost sources — connectors + sync panel.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByRole("heading", { name: "Inference cost sources" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("Anthropic")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();

    // Step 4: Confirm & go live.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Confirm & go live" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Confirm & go live" })).toBeInTheDocument();

    // Back returns to Inference.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Inference cost sources" }),
    ).toBeInTheDocument();
  });

  it("saves a pasted GitHub credential on the features step", async () => {
    vi.mocked(api.saveCredential).mockResolvedValue(undefined);
    renderOnboarding();

    const connectButtons = await screen.findAllByRole("button", { name: "Connect" });
    fireEvent.click(connectButtons[0]); // GitHub (the only connector on step 1)

    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: "ghp_token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.saveCredential).toHaveBeenCalledWith("github", "ghp_token"));
  });

  it("renders a connector as Connected when the API says so", async () => {
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "github", name: "GitHub", category: "features", connected: true },
    ]);
    renderOnboarding();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("shows a demo banner for the demo account (skip straight to dashboard)", async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: "u1",
      tenant_id: "t1",
      email: "demo@annapurna.com",
    });
    renderOnboarding();
    expect(await screen.findByText(/You're viewing the/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip to the demo dashboard →" }),
    ).toBeInTheDocument();
  });
});
