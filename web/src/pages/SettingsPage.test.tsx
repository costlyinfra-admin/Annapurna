import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type OrgSettings } from "../api";
import { SettingsPage } from "./SettingsPage";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      connectors: vi.fn(),
    },
  };
});

const SETTINGS: OrgSettings = {
  org_name: "Transilience AI",
  timezone: "America/Los_Angeles",
  currency: "USD",
  customer_id_storage: "hashed",
  store_prompts: false,
  data_retention: "indefinite",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS });
    vi.mocked(api.updateSettings).mockImplementation(async (p) => ({ ...SETTINGS, ...p }));
  });

  it("shows Organization and Privacy sections with loaded values", async () => {
    renderPage();
    expect(await screen.findByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Privacy & data")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toHaveValue("Transilience AI");
    expect(screen.getByLabelText("Time zone")).toHaveValue("America/Los_Angeles");
    expect(screen.getByLabelText("Default currency")).toHaveValue("USD");
    expect(screen.getByLabelText("Customer identifiers")).toHaveValue("hashed");
    expect(screen.getByLabelText("Data retention")).toHaveValue("indefinite");
  });

  it("does NOT render Connected sources, Account, or a Sign out button", async () => {
    renderPage();
    await screen.findByText("Organization");
    expect(screen.queryByText("Connected sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Account")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    // No provider/connector UI leaks in.
    expect(api.connectors).not.toHaveBeenCalled();
  });

  it("edits and saves the organization name", async () => {
    renderPage();
    const input = await screen.findByLabelText("Organization name");
    fireEvent.change(input, { target: { value: "Acme Security" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ org_name: "Acme Security" }),
      ),
    );
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("saves privacy preferences together", async () => {
    renderPage();
    const toggle = await screen.findByLabelText("Store prompt content");
    fireEvent.click(toggle); // Off -> On
    fireEvent.change(screen.getByLabelText("Data retention"), { target: { value: "90d" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[1]);

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ store_prompts: true, data_retention: "90d" }),
      ),
    );
  });
});
