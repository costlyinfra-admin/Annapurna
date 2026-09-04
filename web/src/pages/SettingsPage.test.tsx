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
      discoveryLlm: vi.fn(),
      discoveryLlmProviders: vi.fn(),
      saveDiscoveryLlm: vi.fn(),
      testDiscoveryLlm: vi.fn(),
      setDiscoveryLlmEnabled: vi.fn(),
      removeDiscoveryLlm: vi.fn(),
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

function setupMocks() {
  vi.clearAllMocks();
  vi.mocked(api.getSettings).mockResolvedValue({ ...SETTINGS });
  vi.mocked(api.updateSettings).mockImplementation(async (p) => ({ ...SETTINGS, ...p }));
  // The BYOK card loads alongside the page; default to "not configured".
  vi.mocked(api.discoveryLlm).mockResolvedValue({
    configured: false,
    enabled: false,
    has_key: false,
  });
  vi.mocked(api.discoveryLlmProviders).mockResolvedValue({
    providers: [
      { value: "groq", base_url: "https://api.groq.com/openai/v1" },
      { value: "custom", base_url: "" },
    ],
    default_model: "llama-3.3-70b-versatile",
  });
}

describe("SettingsPage", () => {
  beforeEach(setupMocks);

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

describe("Feature discovery model (BYOK)", () => {
  beforeEach(setupMocks);

  it("says Annapurna's model is in use until one is configured", async () => {
    renderPage();
    expect(await screen.findByText("Feature discovery model")).toBeInTheDocument();
    expect(screen.getByText("Using Annapurna's model")).toBeInTheDocument();
  });

  it("saves a configuration and never renders the key afterwards", async () => {
    vi.mocked(api.saveDiscoveryLlm).mockResolvedValue({
      configured: true,
      enabled: true,
      has_key: true,
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      base_url: "https://api.groq.com/openai/v1",
    });
    renderPage();
    await screen.findByText("Feature discovery model");

    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "llama-3.3-70b-versatile" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "gsk_secret_value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.saveDiscoveryLlm).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "groq", api_key: "gsk_secret_value" }),
      ),
    );
    expect(await screen.findByText("Using your model")).toBeInTheDocument();
    // The secret is gone from the DOM the moment it is saved.
    expect(document.body.textContent).not.toContain("gsk_secret_value");
    expect(screen.queryByDisplayValue("gsk_secret_value")).toBeNull();
  });

  it("edits without re-entering the key", async () => {
    vi.mocked(api.discoveryLlm).mockResolvedValue({
      configured: true,
      enabled: true,
      has_key: true,
      provider: "groq",
      model: "old-model",
      base_url: "https://api.groq.com/openai/v1",
    });
    vi.mocked(api.saveDiscoveryLlm).mockResolvedValue({
      configured: true,
      enabled: true,
      has_key: true,
      provider: "groq",
      model: "new-model",
      base_url: "https://api.groq.com/openai/v1",
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // The field advertises that a key is stored, and holds no value.
    const key = screen.getByLabelText("API key") as HTMLInputElement;
    expect(key.value).toBe("");
    expect(key.placeholder).toMatch(/leave blank to keep it/i);

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "new-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.saveDiscoveryLlm).toHaveBeenCalled());
    // No api_key sent, so the server keeps the stored one.
    expect(vi.mocked(api.saveDiscoveryLlm).mock.calls[0][0]).not.toHaveProperty("api_key");
  });

  it("reports a failed connection test", async () => {
    vi.mocked(api.testDiscoveryLlm).mockResolvedValue({
      ok: false,
      error: "401: invalid api key: ***",
    });
    renderPage();
    await screen.findByText("Feature discovery model");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/401: invalid api key/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("***"); // redacted, as the server sent it
  });

  it("can switch back to Annapurna's model without discarding the config", async () => {
    vi.mocked(api.discoveryLlm).mockResolvedValue({
      configured: true,
      enabled: true,
      has_key: true,
      provider: "groq",
      model: "m",
      base_url: "u",
    });
    vi.mocked(api.setDiscoveryLlmEnabled).mockResolvedValue({
      configured: true,
      enabled: false,
      has_key: true,
      provider: "groq",
      model: "m",
      base_url: "u",
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Use Annapurna's model" }));

    await waitFor(() => expect(api.setDiscoveryLlmEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByText("Using Annapurna's model")).toBeInTheDocument();
    // Still configured, so it can be switched back on.
    expect(screen.getByRole("button", { name: "Use my model" })).toBeInTheDocument();
  });
});
