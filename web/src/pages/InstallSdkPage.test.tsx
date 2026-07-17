import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("InstallSdkPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the install instructions and the snippet", () => {
    render(<InstallSdkPage />);
    expect(screen.getByRole("heading", { name: "Install SDK" })).toBeInTheDocument();
    // Published on PyPI, so the page shows the plain install command.
    expect(screen.getByText(/pip install annapurna-meter/)).toBeInTheDocument();
  });

  it("generates an ingest token on demand", async () => {
    vi.mocked(api.createHookToken).mockResolvedValue({ token: "ingest_abc123" });
    render(<InstallSdkPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate ingest token" }));
    await waitFor(() => expect(api.createHookToken).toHaveBeenCalled());
    expect(await screen.findByText(/ingest_abc123/)).toBeInTheDocument();
  });
});
