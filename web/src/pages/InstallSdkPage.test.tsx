import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { InstallSdkPage } from "./InstallSdkPage";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    api: { createHookToken: vi.fn() },
  };
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <InstallSdkPage />
    </MemoryRouter>,
  );

describe("InstallSdkPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the install instructions and the snippet", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Install SDK" })).toBeInTheDocument();
    // Published on PyPI and npm — both plain install commands are shown.
    expect(screen.getByText(/pip install annapurna-meter/)).toBeInTheDocument();
    expect(screen.getByText(/npm install annapurna-meter/)).toBeInTheDocument();
    // Both required env vars are documented (the URL was previously missing).
    expect(screen.getByText(/ANNAPURNA_INGEST_URL=/)).toBeInTheDocument();
  });

  it("generates an ingest token on demand", async () => {
    vi.mocked(api.createHookToken).mockResolvedValue({ token: "ingest_abc123" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Generate ingest token" }));
    await waitFor(() => expect(api.createHookToken).toHaveBeenCalled());
    expect(await screen.findByText(/ingest_abc123/)).toBeInTheDocument();
  });
});
