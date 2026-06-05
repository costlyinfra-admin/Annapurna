import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { FeatureDetail } from "./FeatureDetail";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { me: vi.fn(), featureDetail: vi.fn(), logout: vi.fn() } };
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
    { developer_id: "alice", tool: "claude_code", amount: 117, confidence: "high", prs: 2 },
  ],
  inference_trend: [{ period: "2026-05-01", amount: 4200, source: "cost_api" }],
  evidence: [
    { signal_type: "pr", external_ref: "acme/core#1421", confidence: "high", actor: "alice", source: "github" },
  ],
  inference_sources: ["cost_api"],
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
  });

  it("shows separate headlines, breakdowns, and the evidence trail", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "AI threat triage" })).toBeInTheDocument();

    // Build and inference headlines are distinct numbers.
    expect(screen.getAllByText("$181").length).toBeGreaterThan(0); // headline + build total
    expect(screen.getAllByText("$4,200").length).toBeGreaterThan(0); // headline + trend

    // Build-by-developer breakdown: developer, total spend, contributors, PRs.
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Total AI build spend")).toBeInTheDocument();
    expect(screen.getByText("Contributors")).toBeInTheDocument();

    // Evidence trail shows the actual signal behind the number.
    expect(screen.getByText("Evidence trail")).toBeInTheDocument();
    expect(screen.getByText("acme/core#1421")).toBeInTheDocument();

    // Connector-vs-hook indicator (connector for now).
    expect(screen.getByText("connector-derived")).toBeInTheDocument();
  });
});
