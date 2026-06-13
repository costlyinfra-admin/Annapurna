import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";

vi.mock("./api", async (importActual) => {
  const actual = await importActual<typeof import("./api")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      connectors: vi.fn(),
      logout: vi.fn(),
      login: vi.fn(),
      signup: vi.fn(),
      listFeatures: vi.fn(),
    },
  };
});

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects signed-out users to the login page", async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, "Not authenticated"));
    renderApp();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    // One-click demo entry is offered on the login screen.
    expect(screen.getByRole("button", { name: "View the demo" })).toBeInTheDocument();
  });

  it("sends authenticated users into onboarding", async () => {
    vi.mocked(api.me).mockResolvedValue({ id: "u1", tenant_id: "t1", email: "cto@acme.com" });
    vi.mocked(api.connectors).mockResolvedValue([]);
    vi.mocked(api.listFeatures).mockResolvedValue([]);
    renderApp();
    expect(await screen.findByRole("heading", { name: "Identify features" })).toBeInTheDocument();
  });
});
