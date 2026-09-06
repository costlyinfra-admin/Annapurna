/**
 * The alert form's dependency on a real budget.
 *
 * A budget-percentage rule has no denominator without one, so the form must
 * refuse it and point at the place to fix it — never quietly measure against a
 * number the customer did not set.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AlertMeta } from "../api";
import { AlertFormPage } from "./AlertFormPage";
import { AuthProvider } from "../auth/AuthContext";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      alertsMeta: vi.fn(),
      getSettings: vi.fn(),
      listFeatures: vi.fn(),
      createAlert: vi.fn(),
      updateAlert: vi.fn(),
      getAlert: vi.fn(),
    },
  };
});

const META: AlertMeta = {
  metrics: [
    { value: "inference_cost", label: "Inference cost" },
    { value: "combined_cost", label: "Combined AI cost" },
  ],
  scopes: ["organization", "feature"],
  conditions: ["exceeds", "increase_pct", "budget_pct"],
  windows: ["daily", "monthly"],
  cooldowns: ["none", "day"],
  channels: ["in_app", "email"],
  valid_conditions: {
    inference_cost: ["exceeds", "increase_pct", "budget_pct"],
    combined_cost: ["exceeds", "increase_pct", "budget_pct"],
  },
  valid_scopes: { inference_cost: ["organization"], combined_cost: ["organization"] },
  templates: [
    {
      id: "monthly_budget",
      label: "Monthly AI spend exceeds budget",
      requires_budget: true,
      rule: { name: "Over budget", condition_type: "budget_pct", threshold: 100 },
    },
    {
      id: "daily_spike",
      label: "Daily inference cost spikes by 30%",
      rule: { name: "Spike", condition_type: "increase_pct", threshold: 30 },
    },
  ],
  has_budget: false,
  budget_required_message:
    "This alert measures spend against your organization's AI budget, and no budget is " +
    "configured. Set one in Settings -> Budgets, then save this alert.",
  budget_conditions: ["budget_pct"],
};

function renderForm() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AlertFormPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
  vi.mocked(api.getSettings).mockResolvedValue({
    org_name: "Acme",
    timezone: "UTC",
    currency: "USD",
    customer_id_storage: "hashed",
    store_prompts: false,
    data_retention: "indefinite",
  });
  vi.mocked(api.listFeatures).mockResolvedValue([]);
  vi.mocked(api.alertsMeta).mockResolvedValue({ ...META });
});

async function chooseBudgetCondition() {
  await screen.findByLabelText("Condition");
  fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "budget_pct" } });
}

describe("AlertFormPage — budget-backed conditions", () => {
  it("blocks a budget condition when the organization has no budget", async () => {
    renderForm();
    await chooseBudgetCondition();

    expect(await screen.findByText(/no budget is configured/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set a budget/ })).toHaveAttribute(
      "href",
      "/settings#budgets",
    );
  });

  it("will not save that rule, and does not call the API", async () => {
    renderForm();
    await chooseBudgetCondition();
    fireEvent.change(screen.getByLabelText("Alert name"), { target: { value: "Over budget" } });

    const save = screen.getByRole("button", { name: /Create alert|Save/ });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.createAlert).not.toHaveBeenCalled());
  });

  it("offers no budget field: the denominator is the stored budget, not a typed one", async () => {
    renderForm();
    await chooseBudgetCondition();
    expect(screen.queryByLabelText(/Monthly budget/)).not.toBeInTheDocument();
  });

  it("disables the templates that need a budget, and says why", async () => {
    renderForm();
    const template = await screen.findByRole("button", { name: /Monthly AI spend exceeds budget/ });
    expect(template).toBeDisabled();
    expect(template).toHaveAttribute("title", expect.stringContaining("Settings"));
    // The templates that do not need one stay available.
    expect(
      screen.getByRole("button", { name: /Daily inference cost spikes/ }),
    ).not.toBeDisabled();
  });

  it("allows the same rule once a budget exists", async () => {
    vi.mocked(api.alertsMeta).mockResolvedValue({ ...META, has_budget: true });
    renderForm();
    await chooseBudgetCondition();
    fireEvent.change(screen.getByLabelText("Alert name"), { target: { value: "Over budget" } });

    expect(screen.queryByText(/no budget is configured/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create alert|Save/ })).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Monthly AI spend exceeds budget/ }),
    ).not.toBeDisabled();
  });

  it("leaves non-budget conditions alone when there is no budget", async () => {
    renderForm();
    await screen.findByLabelText("Condition");
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "increase_pct" } });
    fireEvent.change(screen.getByLabelText("Alert name"), { target: { value: "Spike" } });

    expect(screen.queryByText(/no budget is configured/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create alert|Save/ })).not.toBeDisabled();
  });
});
