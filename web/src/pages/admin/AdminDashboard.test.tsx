import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { AdminCustomers } from "./AdminCustomers";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../../api", async (importActual) => {
  const actual = await importActual<typeof import("../../api")>();
  return { ...actual, api: { adminOverview: vi.fn(), adminCustomers: vi.fn() } };
});

describe("Admin portal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dashboard shows the six KPIs, measured and verified kept distinct", async () => {
    vi.mocked(api.adminOverview).mockResolvedValue({
      total_customers: 4,
      connected_customers: 3,
      pending_connections: 1,
      total_ai_spend: 5450,
      total_opportunities: 12,
      total_verified_savings: 1572,
    });
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Total customers")).toBeInTheDocument();
    expect(screen.getByText("Verified savings")).toBeInTheDocument();
    expect(screen.getByText("$5,450/mo")).toBeInTheDocument(); // total AI spend
    expect(screen.getByText("$1,572/yr")).toBeInTheDocument(); // verified
    expect(screen.getByText("Pending connections")).toBeInTheDocument();
  });

  it("customer list links each row to its detail view", async () => {
    vi.mocked(api.adminCustomers).mockResolvedValue([
      {
        tenant_id: "t1",
        company: "Acme Security",
        created_at: "2026-01-01",
        status: "connected",
        connected_providers: ["anthropic", "github"],
        last_sync: "2026-05-01T10:00:00Z",
        monthly_spend: 4200,
        opportunities: 5,
        verified_savings: 131,
      },
    ]);
    render(
      <MemoryRouter>
        <AdminCustomers />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "Acme Security" });
    expect(link).toHaveAttribute("href", "/admin/customers/t1");
    expect(screen.getByText("anthropic, github")).toBeInTheDocument();
    expect(screen.getByText("$4,200/mo")).toBeInTheDocument();
  });
});
