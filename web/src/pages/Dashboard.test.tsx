import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { Dashboard } from "./Dashboard";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      dashboard: vi.fn(),
      providerSpend: vi.fn(),
      customerSpend: vi.fn(),
      refreshInference: vi.fn(),
    },
  };
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

/** An empty ProviderSpend — spread it and override only what a test cares about. */
const EMPTY_SPEND = {
  start: "2026-05-01",
  end: "2026-05-01",
  total: 0,
  by_provider: [],
  trend: [],
  daily_trend: [],
  build_total: 0,
  build_by_tool: [],
  developer_activity: [],
  build_by_developer: [],
  build_trend: [],
  customer_total: 0,
  by_customer: [],
  token_total: 0,
  by_token_type: [],
  workspace_total: 0,
  by_workspace: [],
};

const DATA = {
  period: "2026-05-01",
  start: "2026-05-01",
  end: "2026-05-01",
  months: 1,
  features: [TRIAGE],
  unattributed: { build_cost: 30, inference_cost: 760 },
  highlights: { most_expensive: TRIAGE, optimization: null, highest_cost_per_user: TRIAGE },
  insights: [
    {
      kind: "spike",
      text: "May 9 was the costliest day at $300 — 15x the $20.00 median day this period.",
    },
    { kind: "concentration", text: "AI threat triage represents 54% of all AI spend ($4,381)." },
    { kind: "governance", text: "Unattributed spend represents 9.7% of total AI costs ($790)." },
  ],
  // When cost was last INGESTED (not when the page loaded).
  data_updated_at: "2026-08-20T16:07:00Z",
  inference_updated_at: "2026-08-20T16:07:00Z",
  build_updated_at: "2026-08-19T09:00:00Z",
  totals: {
    build_cost: 211,
    inference_cost: 4960,
    estimated_inference: 0,
    prev_build_cost: 180,
    prev_inference_cost: 5200,
    tokens_in: 1_200_000,
    tokens_out: 300_000,
  },
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
    vi.mocked(api.me).mockResolvedValue({
      id: "u1",
      tenant_id: "t1",
      email: "cto@acme.com",
      org_name: "Transilience AI",
    });
    vi.mocked(api.dashboard).mockResolvedValue(DATA);
    vi.mocked(api.refreshInference).mockResolvedValue({
      providers: 1,
      synced: [{ provider: "anthropic", total: 4960 }],
      errors: [],
      total: 4960,
    });
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
      screen.getByText("AI threat triage represents 54% of all AI spend ($4,381)."),
    ).toBeInTheDocument();
    // The kind drives the bullet's tone (anomalies read red, context reads accent).
    expect(screen.getByText(/costliest day at \$300/).className).toContain("insight--spike");
  });

  it("shows month-over-month deltas and a token split", async () => {
    renderDashboard();
    await screen.findByText("Key insights");
    // Build up (211 vs 180), inference down (4960 vs 5200) vs last month.
    expect(screen.getByText(/▲ 17% vs last month/)).toBeInTheDocument();
    expect(screen.getByText(/▼ 5% vs last month/)).toBeInTheDocument();
    // New Total tokens card with the input/output split.
    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("1.5M")).toBeInTheDocument();
    expect(screen.getByText(/1\.2M in · 300K out/)).toBeInTheDocument();
  });

  it("labels the estimated (not-yet-billed) portion of inference cost", async () => {
    vi.mocked(api.dashboard).mockResolvedValue({
      ...DATA,
      totals: { ...DATA.totals, inference_cost: 4960, estimated_inference: 89.42 },
    });
    renderDashboard();
    expect(await screen.findByText(/incl\. ~\$89\.42 estimated/)).toBeInTheDocument();
  });

  it("shows the setup checklist until features + build + inference all exist", async () => {
    // No features, no cost yet -> all three items pending.
    vi.mocked(api.dashboard).mockResolvedValue({
      ...DATA,
      features: [],
      totals: {
        build_cost: 0,
        inference_cost: 0,
        estimated_inference: 0,
        prev_build_cost: 0,
        prev_inference_cost: 0,
        tokens_in: 0,
        tokens_out: 0,
      },
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

  it("switches to the By provider tab and shows provider spend + trend", async () => {
    vi.mocked(api.providerSpend).mockResolvedValue({
      start: "2026-05-01",
      end: "2026-05-01",
      total: 5450,
      by_provider: [
        {
          provider: "openai",
          amount: 4200,
          pct: 77.06,
          requests: 320000,
          by_model: [{ model: "gpt-4o", amount: 4200, pct: 100 }],
        },
        {
          provider: "anthropic",
          amount: 1250,
          pct: 22.94,
          requests: 60000,
          by_model: [{ model: "claude-sonnet-4-6", amount: 1250, pct: 100 }],
        },
      ],
      trend: [
        {
          period: "2026-05-01",
          total: 5450,
          production: 3000,
          development: 1450,
          internal: 500,
          unclassified: 500,
        },
      ],
      daily_trend: [],
      build_total: 270,
      build_by_tool: [
        { tool: "claude_code", amount: 181, pct: 67.04 },
        { tool: "cursor", amount: 89, pct: 32.96 },
      ],
      developer_activity: [],
      build_by_developer: [
        {
          developer_id: "erin",
          label: "Erin (erin)",
          amount: 181,
          pct: 67.04,
          by_tool: [{ tool: "claude_code", amount: 181, pct: 100 }],
        },
        {
          developer_id: "frank",
          label: "Frank (frank)",
          amount: 89,
          pct: 32.96,
          by_tool: [{ tool: "cursor", amount: 89, pct: 100 }],
        },
      ],
      build_trend: [{ period: "2026-05-01", amount: 270 }],
      customer_total: 900,
      by_customer: [{ customer_id: "acme", amount: 900, pct: 100, requests: 1200 }],
      token_total: 5450,
      by_token_type: [
        { token_type: "output", label: "Output", amount: 3000, pct: 55.05, tokens: 300000 },
        { token_type: "input", label: "Input", amount: 2450, pct: 44.95, tokens: 1200000 },
      ],
      workspace_total: 1250,
      by_workspace: [
        {
          workspace: "Triage WS",
          amount: 1250,
          pct: 100,
          tokens: 1500000,
          by_key: [{ api_key: "triage-key", amount: 1250, pct: 100, tokens: 1500000 }],
        },
      ],
    });
    renderDashboard();
    // Features tab is the default view.
    await screen.findByText("Key insights");

    fireEvent.click(screen.getByRole("tab", { name: "By Provider" }));
    // Spend by source splits into Inference / Build sub-tabs; Inference is default.
    expect(await screen.findByText("Inference (run) cost by provider")).toBeInTheDocument();
    // Build cost lives on the other sub-tab — hidden until selected.
    expect(screen.queryByText("Build cost by tool")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();

    // The inference trend is a stacked classification chart with a compact legend.
    expect(screen.getByText("Trend · by classification")).toBeInTheDocument();
    const legend = screen.getByLabelText("Classification legend");
    ["Production", "Dev / Test", "Internal", "Unclassified"].forEach((label) =>
      expect(within(legend).getByText(label)).toBeInTheDocument(),
    );
    // Four stacked segments render for the single month (production/dev/internal/unclassified).
    expect(document.querySelectorAll(".trend-seg").length).toBe(4);
    // The provider tab follows the Overview's selected period (default this month).
    await waitFor(() => expect(api.providerSpend).toHaveBeenCalledWith({ kind: "this_month" }));
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText(/\$4,200 · 77%/)).toBeInTheDocument();
    // Token-type split sits between the provider and workspace breakdowns, and is
    // labelled as a DERIVED split (providers don't bill per token type).
    expect(screen.getByText("Inference cost by token type")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("derived")).toBeInTheDocument();
    // Provider-reported token counts show alongside the dollars.
    expect(screen.getByText("· 300K tok")).toBeInTheDocument();
    expect(screen.getByText("· 1.2M tok")).toBeInTheDocument();
    // Inference sub-tab also carries workspace/API-key and per-customer breakdowns.
    expect(screen.getByText("Inference cost by workspace & API key")).toBeInTheDocument();
    expect(screen.getByText("Triage WS")).toBeInTheDocument();
    expect(screen.getByText("triage-key")).toBeInTheDocument();
    // ...with the provider-reported token count next to each workspace/key amount.
    expect(screen.getAllByText("· 1.5M tok")).toHaveLength(2);
    expect(screen.getByText("Inference cost by customer")).toBeInTheDocument();
    expect(screen.getByText("acme")).toBeInTheDocument();

    // Switch to the Build cost sub-tab: build shows, inference-by-provider hides.
    fireEvent.click(screen.getByRole("tab", { name: "Build cost" }));
    expect(screen.getByText("Build cost by tool")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText(/\$181 · 67%/)).toBeInTheDocument();
    expect(screen.queryByText("Inference (run) cost by provider")).not.toBeInTheDocument();

    // The summary/insights stay put across tabs; only the breakdown swaps.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Key insights")).toBeInTheDocument();
  });

  it("refetches with the chosen review period", async () => {
    renderDashboard();
    await screen.findByText("Key insights");
    expect(api.dashboard).toHaveBeenCalledWith({ kind: "this_month" });

    fireEvent.change(screen.getByRole("combobox", { name: "Review period" }), {
      target: { value: "last_3_months" },
    });
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledWith({ kind: "last_3_months" }));
  });

  it("switches to the By developer tab and shows build cost per developer", async () => {
    vi.mocked(api.providerSpend).mockResolvedValue({
      start: "2026-05-01",
      end: "2026-05-01",
      total: 0,
      by_provider: [],
      trend: [],
      daily_trend: [],
      build_total: 270,
      build_by_tool: [],
      developer_activity: [],
      build_by_developer: [
        {
          developer_id: "Muzaffar-ni",
          label: "Muzaffar (Muzaffar-ni)",
          amount: 181,
          pct: 67.04,
          by_tool: [{ tool: "claude_code", amount: 181, pct: 100 }],
        },
        {
          // Handle unavailable -> the label is just the name.
          developer_id: "frank",
          label: "Frank",
          amount: 89,
          pct: 32.96,
          by_tool: [{ tool: "cursor", amount: 89, pct: 100 }],
        },
      ],
      build_trend: [{ period: "2026-05-01", amount: 270 }],
      customer_total: 0,
      by_customer: [],
      token_total: 0,
      by_token_type: [],
      workspace_total: 0,
      by_workspace: [],
    });
    renderDashboard();
    await screen.findByText("Key insights");

    fireEvent.click(screen.getByRole("tab", { name: "By Developer" }));
    expect(await screen.findByText("Build cost by developer")).toBeInTheDocument();
    // The combined "Name (handle)" label renders; name-only falls back gracefully.
    expect(screen.getByText("Muzaffar (Muzaffar-ni)")).toBeInTheDocument();
    expect(screen.getByText("Frank")).toBeInTheDocument();
    expect(screen.getByText(/\$181 · 67%/)).toBeInTheDocument();
    // Each developer breaks down by the tool they used.
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("tracks engineering activity per developer under the cost breakdown", async () => {
    vi.mocked(api.providerSpend).mockResolvedValue({
      ...EMPTY_SPEND,
      build_total: 270,
      build_by_developer: [
        {
          developer_id: "bob",
          label: "Bob (bob)",
          amount: 64,
          pct: 100,
          by_tool: [{ tool: "cursor", amount: 64, pct: 100 }],
        },
      ],
      developer_activity: [
        {
          handle: "bob",
          label: "Bob (bob)",
          prs: 11,
          features: 10,
          commits: 37,
          files_changed: 72,
          additions: 1610,
          deletions: 445,
          build_cost: 64,
          cost_per_pr: 5.82,
        },
        {
          // Discovered before line counts were recorded — unknown, not zero.
          handle: "olddev",
          label: "olddev",
          prs: 2,
          features: 1,
          commits: null,
          files_changed: null,
          additions: null,
          deletions: null,
          build_cost: 0,
          cost_per_pr: null,
        },
      ],
    });
    renderDashboard();
    await screen.findByText("Key insights");

    fireEvent.click(screen.getByRole("tab", { name: "By Developer" }));
    expect(await screen.findByText("Engineering activity")).toBeInTheDocument();

    const activity = screen.getByText("Engineering activity").closest("section")!;
    const bob = within(activity).getByText("Bob (bob)").closest("tr")!;
    expect(within(bob).getByText("11")).toBeInTheDocument(); // PRs
    expect(within(bob).getByText(/\+1\.6K/)).toBeInTheDocument(); // lines added
    expect(within(bob).getByText("$5.82")).toBeInTheDocument(); // cost per PR

    // Missing stats read as an em dash, never as a zero that implies no work.
    const old = within(activity).getByText("olddev").closest("tr")!;
    expect(within(old).getAllByText("—").length).toBeGreaterThan(0);

    // Counting shipped work is not a performance rating, and the page says so.
    expect(screen.getByText(/activity, not performance/)).toBeInTheDocument();
  });

  it("shows spend per customer, with unit economics and coverage of the bill", async () => {
    vi.mocked(api.customerSpend).mockResolvedValue({
      start: "2026-05-01",
      end: "2026-05-01",
      months: 1,
      total: 750,
      customers: [
        {
          customer_id: "acme",
          amount: 600,
          pct: 80,
          requests: 20000,
          cost_per_request: 0.03,
          prev_amount: 400,
          delta_pct: 50,
          months_active: 1,
        },
        {
          customer_id: "globex",
          amount: 150,
          pct: 20,
          requests: 30000,
          cost_per_request: 0.005,
          prev_amount: null,
          delta_pct: null,
          months_active: 1,
        },
      ],
      trend: [{ period: "2026-05-01", amount: 750 }],
      inference_total: 5000,
      coverage_pct: 15,
    });
    renderDashboard();
    await screen.findByText("Key insights");

    fireEvent.click(screen.getByRole("tab", { name: "By Customer" }));
    expect(await screen.findByText("Inference cost by customer")).toBeInTheDocument();

    // Every customer is listed in the table (the bars above show only the top few).
    const table = screen.getByRole("table");
    expect(within(table).getByText("acme")).toBeInTheDocument();
    expect(within(table).getByText("globex")).toBeInTheDocument();
    // Sub-cent unit cost keeps its precision instead of rounding to $0.00.
    expect(screen.getByText("$0.005")).toBeInTheDocument();
    expect(screen.getByText("$0.03")).toBeInTheDocument();
    // A customer with no prior spend reads as new, not as a 0% change.
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText(/▲ 50%/)).toBeInTheDocument();
    // Metered spend is a subset of the bill, and the page says how big a subset.
    expect(screen.getByText(/15% of the \$5,000 inference bill/)).toBeInTheDocument();
  });

  it("explains that per-customer cost needs the SDK when nothing is tagged", async () => {
    vi.mocked(api.customerSpend).mockResolvedValue({
      start: "2026-05-01",
      end: "2026-05-01",
      months: 1,
      total: 0,
      customers: [],
      trend: [],
      inference_total: 5000,
      coverage_pct: 0,
    });
    renderDashboard();
    await screen.findByText("Key insights");

    fireEvent.click(screen.getByRole("tab", { name: "By Customer" }));
    expect(await screen.findByText("No customer-attributed spend yet")).toBeInTheDocument();
    expect(screen.getByText(/never who it was spent on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install the SDK" })).toHaveAttribute(
      "href",
      "/install-sdk",
    );
  });

  it("re-pulls the provider/developer breakdowns on refresh", async () => {
    vi.mocked(api.providerSpend).mockResolvedValue({
      start: "2026-05-01",
      end: "2026-05-01",
      total: 0,
      by_provider: [],
      trend: [],
      daily_trend: [],
      build_total: 0,
      build_by_tool: [],
      developer_activity: [],
      build_by_developer: [],
      build_trend: [],
      customer_total: 0,
      by_customer: [],
      token_total: 0,
      by_token_type: [],
      workspace_total: 0,
      by_workspace: [],
    });
    renderDashboard();
    await screen.findByText("Key insights");

    // The inference/build breakdowns live on the By provider tab.
    fireEvent.click(screen.getByRole("tab", { name: "By Provider" }));
    await waitFor(() => expect(api.providerSpend).toHaveBeenCalledTimes(1));

    // Refresh must re-pull them too — not just the summary tiles.
    fireEvent.click(screen.getByRole("button", { name: "Refresh data and alerts" }));
    await waitFor(() => expect(api.providerSpend).toHaveBeenCalledTimes(2));
  });

  it("reports a provider that could not be refreshed", async () => {
    vi.mocked(api.refreshInference).mockResolvedValue({
      providers: 2,
      synced: [{ provider: "anthropic", total: 100 }],
      errors: [{ provider: "openai", error: "Provider rejected the admin key (401)." }],
      total: 100,
    });
    renderDashboard();
    await screen.findByText("Key insights");
    fireEvent.click(screen.getByRole("button", { name: "Refresh data and alerts" }));
    // The failure is surfaced, not swallowed behind unchanged numbers.
    expect(
      await screen.findByText(/Could not refresh openai \(Provider rejected/),
    ).toBeInTheDocument();
  });

  it("stamps when cost was last ingested, not when the page loaded", async () => {
    renderDashboard();
    await screen.findByText("Key insights");
    // Short format, and driven by data_updated_at (Aug 20) — NOT today's date.
    const stamp = screen.getByText(/^Updated [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
    expect(stamp.textContent).toContain("Aug 20");
    // The tooltip breaks freshness down per source.
    expect(stamp.getAttribute("title")).toMatch(/Inference: Aug 20/);
    expect(stamp.getAttribute("title")).toMatch(/Build: Aug 19/);
  });

  it("hides the stamp until cost has been ingested at least once", async () => {
    vi.mocked(api.dashboard).mockResolvedValue({
      ...DATA,
      data_updated_at: null,
      inference_updated_at: null,
      build_updated_at: null,
    });
    renderDashboard();
    await screen.findByText("Key insights");
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });

  it("refreshes data and signals an alerts refresh when the refresh button is clicked", async () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    renderDashboard();
    await screen.findByText("Key insights");
    expect(api.dashboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh data and alerts" }));
    // Pulls fresh cost from connected providers, then re-reads the dashboard and
    // fires the alerts-refresh window event.
    await waitFor(() => expect(api.refreshInference).toHaveBeenCalled());
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledTimes(2));
    expect(dispatch.mock.calls.some(([e]) => e.type === "annapurna:refresh-alerts")).toBe(true);
  });
});
