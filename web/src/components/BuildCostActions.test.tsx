import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { BuildCostActions } from "./BuildCostActions";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return { ...actual, api: { listSeatSources: vi.fn() } };
});

describe("BuildCostActions — CSV help", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listSeatSources).mockResolvedValue([]);
  });

  it("documents the developer,github_handle,tool,amount format with an example", async () => {
    render(<BuildCostActions features={[]} onChanged={async () => {}} />);

    // Expand the CSV import card (awaiting the button also flushes the mount effect).
    fireEvent.click(await screen.findByRole("button", { name: /Import a CSV/ }));

    // The header format is documented and github_handle is explained.
    expect(screen.getByText("developer,github_handle,tool,amount")).toBeInTheDocument();
    expect(screen.getByText(/attribute PRs to features/i)).toBeInTheDocument();
    // The example row uses the new format.
    expect(
      screen.getByPlaceholderText(/Muzaffar,Muzaffar-ni,claude_code,50\.00/),
    ).toBeInTheDocument();
  });
});
