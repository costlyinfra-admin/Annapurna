import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type BillingOpportunity, type CopilotOverview } from "../api";
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
      overlaps: null,
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
  has_sdk_telemetry: true,
  has_billing_data: true,
  billing_opportunities: [],
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

const SPEND_TO_REVIEW: BillingOpportunity = {
  id: "unclassified:anthropic:k1",
  type: "unclassified_spend",
  title: "Classify prod-key",
  description: "anthropic spend on this resource is not classified.",
  evidence: {
    source: "provider billing (cost API) + resource classification",
    period_start: "2026-05-01",
    period_end: "2026-05-01",
    observed_cost: 4200,
    token_count: null,
    resource_id: "k1",
    calculation: "SUM(inference_cost.amount) for this resource over the period",
  },
  confidence: "high",
  impact: { kind: "spend_to_review", amount: 4200 },
  savings: {
    kind: "not_quantified",
    amount: null,
    explanation: "Classifying spend changes reporting, not the bill.",
  },
  limitations: ["Shows where spend is unlabelled — not that it is wasteful."],
  action: { label: "Review classification", href: "/cost-sources" },
};

const NO_SDK: CopilotOverview = {
  ...OVERVIEW,
  totals: { measured: 0, modeled_ceiling: 0, directional: 0 },
  top_recommendations: [],
  by_feature: [],
  by_lever: [],
  applied: [],
  has_sdk_telemetry: false,
  has_billing_data: true,
  billing_opportunities: [SPEND_TO_REVIEW],
};

describe("CopilotPage — billing-only path (no SDK)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows evidence-backed billing findings instead of a blank page", async () => {
    vi.mocked(api.copilotOverview).mockResolvedValue(NO_SDK);
    renderPage();

    expect(await screen.findByText("What you can optimize from billing data")).toBeInTheDocument();
    // The scope disclaimer is explicit about what these do NOT infer.
    expect(
      screen.getByText(/do not infer prompt, model, caching, quality, user, or feature-level/i),
    ).toBeInTheDocument();
    // The finding, its label, and its observed amount.
    expect(screen.getByText("Spend to review")).toBeInTheDocument();
    expect(screen.getByText("Classify prod-key")).toBeInTheDocument();
    expect(screen.getByText("$4,200")).toBeInTheDocument();
    // Reviewable spend is NEVER presented as savings.
    expect(screen.getByText(/Not quantified/)).toBeInTheDocument();
    // Full evidence trail: source, period and calculation are all on screen.
    expect(screen.getByText(/provider billing \(cost API\)/)).toBeInTheDocument();
    expect(screen.getByText(/SUM\(inference_cost.amount\)/)).toBeInTheDocument();
    // And a real action.
    expect(screen.getByRole("link", { name: /Review classification/ })).toHaveAttribute(
      "href",
      "/cost-sources",
    );
  });

  it("invites the SDK without implying the page is broken", async () => {
    vi.mocked(api.copilotOverview).mockResolvedValue(NO_SDK);
    renderPage();
    await screen.findByText("What you can optimize from billing data");
    expect(
      screen.getByText(/Request-, user- and feature-level optimizations/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install the SDK" })).toHaveAttribute(
      "href",
      "/install-sdk",
    );
  });

  it("keeps the honest setup empty state with no SDK and no billing data", async () => {
    vi.mocked(api.copilotOverview).mockResolvedValue({
      ...NO_SDK,
      has_billing_data: false,
      billing_opportunities: [],
    });
    renderPage();
    await screen.findByText("Top recommendations");
    // No billing section is invented out of nothing.
    expect(screen.queryByText("What you can optimize from billing data")).not.toBeInTheDocument();
    expect(
      screen.getByText("No measured opportunities yet across your features."),
    ).toBeInTheDocument();
  });

  it("keeps SDK recommendations in their own section when both exist", async () => {
    vi.mocked(api.copilotOverview).mockResolvedValue({
      ...OVERVIEW,
      has_sdk_telemetry: true,
      has_billing_data: true,
      billing_opportunities: [SPEND_TO_REVIEW],
    });
    renderPage();
    // Billing findings and measured recommendations coexist, separately.
    expect(await screen.findByText("What you can optimize from billing data")).toBeInTheDocument();
    expect(screen.getByText("Top recommendations")).toBeInTheDocument();
    expect(screen.getByText("Cheaper provider")).toBeInTheDocument();
    // With telemetry present, we don't nag about installing the SDK.
    expect(screen.queryByRole("link", { name: "Install the SDK" })).not.toBeInTheDocument();
  });
});
