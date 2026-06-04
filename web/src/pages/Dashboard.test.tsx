import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { Dashboard } from "./Dashboard";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { me: vi.fn(), dashboard: vi.fn(), logout: vi.fn() } };
});

const DATA = {
  period: "2026-05-01",
  features: [
    {
      feature_id: "f1",
      name: "AI threat triage",
      build_cost: 181,
      inference_cost: 4200,
      active_users: 540,
      cost_per_user: 7.77,
      worth_it: "healthy",
      confidence: "med",
    },
  ],
  unattributed: { build_cost: 30, inference_cost: 760 },
  totals: { build_cost: 211, inference_cost: 4960 },
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Dashboard />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
    vi.mocked(api.dashboard).mockResolvedValue(DATA);
  });

  it("shows build and inference as separate columns, plus the Unattributed row", async () => {
    renderDashboard();

    const row = await screen.findByRole("link", { name: "AI threat triage" });
    expect(row).toHaveAttribute("href", "/features/f1");

    // Build and inference appear as distinct values (never one blended number).
    expect(screen.getByText("$181")).toBeInTheDocument();
    expect(screen.getByText("$4,200")).toBeInTheDocument();

    // Unattributed bucket row.
    expect(screen.getByText("Unattributed")).toBeInTheDocument();
    expect(screen.getByText("$760")).toBeInTheDocument();

    // Directional worth-it indicator.
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });
});
