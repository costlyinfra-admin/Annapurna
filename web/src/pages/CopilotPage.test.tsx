import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type CopilotOverview } from "../api";
import { CopilotPage } from "./CopilotPage";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { copilotOverview: vi.fn() } };
});

const OVERVIEW: CopilotOverview = {
  period: "2026-05-01",
  totals: { measured: 707.99, modeled_ceiling: 3126.67, directional: 795.53 },
  verified_monthly_savings: 131,
  verified_annual_savings: 1572,
  top_recommendations: [
    {
      lever: "model_rightsizing",
      title: "Model right-sizing",
      source: "connector",
      savings_type: "modeled_ceiling",
      confidence: "med",
      confidence_reason: "ceiling",
      projected_monthly_savings: 3126.67,
      projected_annual_savings: 37520,
      engineering_effort: "high",
      priority_score: 562.8,
      evidence: "sonnet -> haiku",
      fix: null,
      validation_guidance: "eval first",
      verification: "spend drops",
      status: "detected",
      trail: [],
      feature_id: "f1",
      feature_name: "AI threat triage",
    },
  ],
  by_feature: [
    {
      feature_id: "f1",
      name: "AI threat triage",
      measured: 634,
      modeled_ceiling: 3126.67,
      directional: 795.53,
    },
    {
      feature_id: "f2",
      name: "Log enrichment",
      measured: 73.2,
      modeled_ceiling: 0,
      directional: 0,
    },
  ],
  by_lever: [
    {
      lever: "provider_switch",
      title: "Cheaper provider",
      savings_type: "measured",
      monthly: 73.2,
      count: 1,
    },
  ],
  applied: [
    {
      lever: "duplicate_calls",
      applied_on: "2026-03-01",
      projected_monthly: 500,
      current_avoidable: 369,
      realized_monthly: 131,
      status: "verified",
      feature_id: "f1",
      feature_name: "AI threat triage",
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CopilotPage />
    </MemoryRouter>,
  );
}

describe("CopilotPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.copilotOverview).mockResolvedValue(OVERVIEW);
  });

  it("shows three distinct savings figures, never combined", async () => {
    renderPage();
    expect(await screen.findByText("Optimization Copilot")).toBeInTheDocument();
    // Measured (guaranteed), modeled ceiling ("up to"), verified (annualized).
    expect(screen.getByText("$708/mo")).toBeInTheDocument();
    expect(screen.getAllByText("up to $3,127/mo").length).toBeGreaterThan(0); // KPI + rollups
    expect(screen.getByText("$1,572/yr")).toBeInTheDocument();
    // The three figures are labelled distinctly and never blended.
    expect(screen.getByText("Measured savings")).toBeInTheDocument();
    expect(screen.getByText("Modeled ceiling")).toBeInTheDocument();
    expect(screen.getByText("Verified savings")).toBeInTheDocument();
  });

  it("renders ranked top recommendations, by-feature, by-lever and applied rollups", async () => {
    renderPage();
    expect(await screen.findByText("Top recommendations")).toBeInTheDocument();
    // Recommendation links to its feature.
    const links = screen.getAllByRole("link", { name: "AI threat triage" });
    expect(links[0]).toHaveAttribute("href", "/features/f1");
    expect(screen.getByText("By feature")).toBeInTheDocument();
    expect(screen.getByText("By lever")).toBeInTheDocument();
    expect(screen.getByText("Cheaper provider")).toBeInTheDocument();
    // The verified rollup.
    expect(screen.getByText(/✓ Verified/)).toBeInTheDocument();
  });
});
