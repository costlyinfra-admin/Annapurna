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
      { type: "github", name: "GitHub", category: "build_activity", connected: false },
      { type: "anthropic", name: "Anthropic", category: "inference", connected: false },
    ]);
    vi.mocked(api.listFeatures).mockResolvedValue([]); // empty states in Review/Confirm
  });

  it("walks Connect -> Review -> Confirm and back", async () => {
    renderOnboarding();

    // Step 1: Connect — connectors load from the API.
    expect(await screen.findByRole("heading", { name: "Connect your sources" })).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();

    // Step 2: Review — empty state.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Review auto-discovered features" })).toBeInTheDocument();
    expect(await screen.findByText("No features discovered yet")).toBeInTheDocument();

    // Step 3: Confirm — go-live step.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Confirm & go live" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Confirm & go live" })).toBeInTheDocument();

    // Back returns to Review.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Review auto-discovered features" }),
    ).toBeInTheDocument();
  });

  it("saves a pasted credential through the Connect step", async () => {
    vi.mocked(api.saveCredential).mockResolvedValue(undefined);
    renderOnboarding();

    const connectButtons = await screen.findAllByRole("button", { name: "Connect" });
    fireEvent.click(connectButtons[0]); // GitHub

    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: "ghp_token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.saveCredential).toHaveBeenCalledWith("github", "ghp_token"),
    );
  });

  it("renders a connector as Connected when the API says so", async () => {
    vi.mocked(api.connectors).mockResolvedValue([
      { type: "github", name: "GitHub", category: "build_activity", connected: true },
    ]);
    renderOnboarding();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
