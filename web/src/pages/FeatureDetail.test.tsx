import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { FeatureDetail } from "./FeatureDetail";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      featureDetail: vi.fn(),
      featureInference: vi.fn(),
      featureOpportunities: vi.fn(),
      logout: vi.fn(),
    },
  };
});

const OPPORTUNITIES = {
  period: "2026-05-01",
  measured: {
    opportunities: [
      {
        lever: "prompt_caching",
        savings: 264.79,
        confidence: "high",
        evidence: "a 4,100-token static prefix repeated across 23,920 uncached calls",
        fix: "Enable prompt caching (set cache_control on the static system block).",
        trail: [
          {
            fingerprint: "prefix-syste",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            calls: 26000,
            prefix_tokens: 4100,
            cached: 2080,
          },
        ],
      },
      {
        lever: "duplicate_calls",
        savings: 369.0,
        confidence: "high",
        evidence: "1,240 duplicate calls across 3 distinct requests this month",
        fix: "Add response caching for identical requests (e.g. keyed on the request hash).",
        trail: [
          {
            fingerprint: "dup-alert-fo",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            call_count: 620,
          },
        ],
      },
    ],
    monthly_savings: 633.79,
    annual_savings: 7605.48,
  },
  estimated: {
    opportunities: [
      {
        opportunity: "Model downgrade",
        savings: 70,
        confidence: "med",
        rationale: "Route cheaper.",
      },
    ],
    monthly_savings: 70,
    annual_savings: 840,
  },
  cache_utilization: 0.08,
};

const DETAIL = {
  feature_id: "f1",
  name: "AI threat triage",
  description: "Classifies alerts.",
  status: "confirmed",
  discovery_confidence: "high",
  period: "2026-05-01",
  headline: { build_cost: 181, inference_cost: 4200, active_users: 540, avg_latency_ms: 820 },
  build_total: 181,
  build_contributors: 2,
  build_by_developer: [
    {
      developer_id: "alice",
      tool: "claude_code",
      amount: 117,
      confidence: "high",
      prs: 2,
      commits: 14,
      files_changed: 37,
    },
  ],
  evidence: [
    {
      signal_type: "pr",
      external_ref: "acme/core#1421",
      confidence: "high",
      actor: "alice",
      source: "github",
    },
  ],
  inference_sources: ["cost_api"],
  optimization: {
    opportunities: [
      {
        opportunity: "Prompt caching",
        savings: 504,
        confidence: "high",
        rationale: "Cache repeated prompt prefixes.",
      },
      {
        opportunity: "Model downgrade",
        savings: 420,
        confidence: "med",
        rationale: "Route to a cheaper model.",
      },
    ],
    monthly_savings: 924,
    annual_savings: 11088,
  },
};

const INFERENCE = {
  window: "month",
  total: 1850,
  by_model: [
    { model: "gpt-4o", amount: 1250, pct: 67.6, requests: 60000 },
    { model: "claude-sonnet-4-6", amount: 400, pct: 21.6, requests: 20000 },
    { model: "claude-haiku-4-5", amount: 200, pct: 10.8, requests: 8000 },
  ],
  trend: [{ period: "2026-05-01", amount: 1850 }],
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/features/f1"]}>
      <AuthProvider>
        <Routes>
          <Route path="/features/:id" element={<FeatureDetail />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("FeatureDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
    vi.mocked(api.featureDetail).mockResolvedValue(DETAIL);
    vi.mocked(api.featureInference).mockResolvedValue(INFERENCE);
    vi.mocked(api.featureOpportunities).mockResolvedValue(OPPORTUNITIES);
  });

  it("organizes into Developer cost and Inference cost sections", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "AI threat triage" })).toBeInTheDocument();

    // Avg latency from metered (SDK) calls shows in the header.
    expect(screen.getByText(/820 ms avg latency/)).toBeInTheDocument();

    // Developer cost section: total spend + per-developer breakdown.
    expect(screen.getByText("Developer cost")).toBeInTheDocument();
    expect(screen.getByText("$181")).toBeInTheDocument(); // total build spend
    expect(screen.getByText("alice")).toBeInTheDocument();

    // Inference cost section: window filter + connector indicator.
    expect(screen.getByText("Inference cost")).toBeInTheDocument();
    expect(screen.getByText(/connector-derived/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quarter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year" })).toBeInTheDocument();

    // Pie (by model) + trend chart load from the inference endpoint.
    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Inference cost by model" })).toBeInTheDocument();
    expect(screen.getByText("May")).toBeInTheDocument(); // trend bar label

    // Optimization: measured findings on top, estimated (heuristic) demoted.
    expect(screen.getByText("Optimization opportunities")).toBeInTheDocument();
    expect(await screen.findByText("Prompt caching")).toBeInTheDocument(); // measured lever
    expect(screen.getByText("Duplicate calls")).toBeInTheDocument(); // measured lever
    // Measured evidence sentence + the specific fix render.
    expect(
      screen.getByText(/1,240 duplicate calls across 3 distinct requests/),
    ).toBeInTheDocument();
    expect(screen.getByText("$634/mo")).toBeInTheDocument(); // measured savings headline (rounded)
    // Current cache utilization context.
    expect(screen.getByText(/8% of prefixed input is already cached/)).toBeInTheDocument();
    // Estimated tier is present but clearly separate (the heuristic lever).
    expect(screen.getByText("Model downgrade")).toBeInTheDocument();
    expect(screen.getByText("directional estimate")).toBeInTheDocument();
  });

  it("nudges installing the SDK when there are no measured opportunities", async () => {
    vi.mocked(api.featureOpportunities).mockResolvedValue({
      ...OPPORTUNITIES,
      measured: { opportunities: [], monthly_savings: 0, annual_savings: 0 },
      cache_utilization: null,
    });
    renderDetail();
    expect(await screen.findByText(/Install the metering SDK/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Install SDK/ })).toHaveAttribute(
      "href",
      "/install-sdk",
    );
    // The estimated tier still shows below the nudge.
    expect(screen.getByText("Model downgrade")).toBeInTheDocument();
  });

  it("refetches the breakdown when the window changes", async () => {
    renderDetail();
    await screen.findByText("gpt-4o");
    expect(api.featureInference).toHaveBeenCalledWith("f1", "month");

    fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await waitFor(() => expect(api.featureInference).toHaveBeenCalledWith("f1", "quarter"));
  });
});
