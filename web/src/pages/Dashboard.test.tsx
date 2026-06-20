import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { Dashboard } from "./Dashboard";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { me: vi.fn(), dashboard: vi.fn() } };
});

const TRIAGE = {
  feature_id: "f1",
  name: "AI threat triage",
  build_cost: 181,
  inference_cost: 4200,
  active_users: 540,
  cost_per_user: 7.77,
  requests: 320000,
  worth_it: "healthy",
  confidence: "med",
};

const DATA = {
  period: "2026-05-01",
  features: [TRIAGE],
  unattributed: { build_cost: 30, inference_cost: 760 },
  highlights: { most_expensive: TRIAGE, optimization: null, highest_cost_per_user: TRIAGE },
  insights: [
    { kind: "concentration", text: "AI threat triage represents 54% of all AI spend." },
    { kind: "governance", text: "Unattributed spend represents 9.7% of total AI costs." },
  ],
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

describe("Dashboard (Overview)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
    vi.mocked(api.dashboard).mockResolvedValue(DATA);
  });

  it("shows build and inference as separate columns, plus the Unattributed row", async () => {
    renderDashboard();

    const links = await screen.findAllByRole("link", { name: "AI threat triage" });
    expect(links[0]).toHaveAttribute("href", "/features/f1");

    // Build and inference appear as distinct values (never one blended number).
    expect(screen.getByText("$181")).toBeInTheDocument();
    expect(screen.getByText("$4,200")).toBeInTheDocument();

    expect(screen.getByText("Unattributed")).toBeInTheDocument();
    expect(screen.getByText("$760")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders the executive summary", async () => {
    renderDashboard();
    expect(await screen.findByText("Most expensive")).toBeInTheDocument();
    expect(screen.getByText("Optimization")).toBeInTheDocument();
    expect(screen.getByText("Highest cost / user")).toBeInTheDocument();
    expect(screen.getByText("Unattributed spend")).toBeInTheDocument();
    expect(screen.getByText("$790")).toBeInTheDocument(); // build 30 + inference 760
    expect(screen.getByText("Nothing flagged")).toBeInTheDocument();
  });

  it("renders auto-generated key insights", async () => {
    renderDashboard();
    expect(await screen.findByText("Key insights")).toBeInTheDocument();
    expect(
      screen.getByText("AI threat triage represents 54% of all AI spend."),
    ).toBeInTheDocument();
  });

  it("shows the setup checklist until features + build + inference all exist", async () => {
    // No features, no cost yet -> all three items pending.
    vi.mocked(api.dashboard).mockResolvedValue({
      ...DATA,
      features: [],
      totals: { build_cost: 0, inference_cost: 0 },
    });
    renderDashboard();

    expect(await screen.findByText("Finish setting up")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Discover features/ })).toHaveAttribute(
      "href",
      "/features",
    );
    expect(screen.getByRole("link", { name: /Add build cost/ })).toHaveAttribute(
      "href",
      "/cost-sources",
    );
  });

  it("hides the checklist once setup is complete", async () => {
    renderDashboard(); // DATA has features + build + inference cost
    await screen.findByText("Key insights");
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });
});
