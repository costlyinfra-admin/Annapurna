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

const TRIAGE = {
  feature_id: "f1",
  name: "AI threat triage",
  build_cost: 181,
  inference_cost: 4200,
  active_users: 540,
  cost_per_user: 7.77,
  worth_it: "healthy",
  confidence: "med",
};

const DATA = {
  period: "2026-05-01",
  features: [TRIAGE],
  unattributed: { build_cost: 30, inference_cost: 760 },
  highlights: {
    most_expensive: TRIAGE,
    optimization: null,
    highest_cost_per_user: TRIAGE,
  },
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

    // Feature links appear in the table (and the exec summary); all point to the drill-down.
    const links = await screen.findAllByRole("link", { name: "AI threat triage" });
    expect(links[0]).toHaveAttribute("href", "/features/f1");

    // Build and inference appear as distinct values (never one blended number).
    expect(screen.getByText("$181")).toBeInTheDocument();
    expect(screen.getByText("$4,200")).toBeInTheDocument();

    // Unattributed bucket row.
    expect(screen.getByText("Unattributed")).toBeInTheDocument();
    expect(screen.getByText("$760")).toBeInTheDocument();

    // Directional worth-it indicator.
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders the executive summary cards", async () => {
    renderDashboard();
    expect(await screen.findByText("Most expensive feature")).toBeInTheDocument();
    expect(screen.getByText("Largest optimization opportunity")).toBeInTheDocument();
    expect(screen.getByText("Highest cost / user")).toBeInTheDocument();
    expect(screen.getByText("Unattributed spend")).toBeInTheDocument();
    // Unattributed total = build 30 + inference 760.
    expect(screen.getByText("$790")).toBeInTheDocument();
    // "optimization" is null in the mock -> graceful empty state.
    expect(screen.getByText("Nothing flagged")).toBeInTheDocument();
  });
});
