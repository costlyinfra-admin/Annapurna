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
    api: { me: vi.fn(), featureDetail: vi.fn(), featureInference: vi.fn(), logout: vi.fn() },
  };
});

const DETAIL = {
  feature_id: "f1",
  name: "AI threat triage",
  description: "Classifies alerts.",
  status: "confirmed",
  discovery_confidence: "high",
  period: "2026-05-01",
  headline: { build_cost: 181, inference_cost: 4200, active_users: 540 },
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
    { signal_type: "pr", external_ref: "acme/core#1421", confidence: "high", actor: "alice", source: "github" },
  ],
  inference_sources: ["cost_api"],
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
  });

  it("organizes into Developer cost and Inference cost sections", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "AI threat triage" })).toBeInTheDocument();

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
  });

  it("refetches the breakdown when the window changes", async () => {
    renderDetail();
    await screen.findByText("gpt-4o");
    expect(api.featureInference).toHaveBeenCalledWith("f1", "month");

    fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await waitFor(() => expect(api.featureInference).toHaveBeenCalledWith("f1", "quarter"));
  });
});
