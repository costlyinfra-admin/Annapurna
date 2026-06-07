import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Feature } from "../../api";
import { ReviewStep } from "./ReviewStep";

vi.mock("../../api", async (importActual) => {
  const actual = await importActual<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      listFeatures: vi.fn(),
      runDiscovery: vi.fn(),
      addFeature: vi.fn(),
      renameFeature: vi.fn(),
      deleteFeature: vi.fn(),
      splitFeature: vi.fn(),
      mergeFeatures: vi.fn(),
    },
  };
});

const THREAT: Feature = {
  id: "f1",
  name: "Threat",
  description: "",
  status: "proposed",
  discovery_confidence: "high",
  signals: [
    { id: "s1", signal_type: "pr", external_ref: "acme/core#1", confidence: "high" },
    { id: "s2", signal_type: "pr", external_ref: "acme/core#2", confidence: "high" },
    { id: "s3", signal_type: "branch", external_ref: "feature/threat-*", confidence: "high" },
  ],
};

describe("ReviewStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs discovery and renders proposals with evidence + confidence", async () => {
    vi.mocked(api.listFeatures).mockResolvedValueOnce([]).mockResolvedValue([THREAT]);
    vi.mocked(api.runDiscovery).mockResolvedValue({
      owner: "acme",
      prs: 3,
      repos: ["acme/core"],
      repos_scanned: 2,
      proposals: 1,
    });

    render(<ReviewStep />);
    expect(await screen.findByText("No features discovered yet")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("GitHub organization"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze last 90 days" }));

    expect(await screen.findByText(/Analyzed 3 merged PRs/)).toBeInTheDocument();
    expect(await screen.findByText("Threat")).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    expect(screen.getByText("acme/core#1")).toBeInTheDocument();
    expect(screen.getByText("branch: feature/threat-*")).toBeInTheDocument();
  });

  it("explains when no repositories are accessible (token/owner issue)", async () => {
    vi.mocked(api.listFeatures).mockResolvedValue([]);
    vi.mocked(api.runDiscovery).mockResolvedValue({
      owner: "cloudoku-training",
      prs: 0,
      repos: [],
      repos_scanned: 0,
      proposals: 0,
    });

    render(<ReviewStep />);
    fireEvent.change(await screen.findByLabelText("GitHub organization"), {
      target: { value: "cloudoku-training" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze last 90 days" }));

    expect(await screen.findByText(/No repositories accessible/)).toBeInTheDocument();
  });

  it("explains when repos are found but have no merged PRs", async () => {
    vi.mocked(api.listFeatures).mockResolvedValue([]);
    vi.mocked(api.runDiscovery).mockResolvedValue({
      owner: "cloudoku-training",
      prs: 0,
      repos: [],
      repos_scanned: 1,
      proposals: 0,
    });

    render(<ReviewStep />);
    fireEvent.change(await screen.findByLabelText("GitHub organization"), {
      target: { value: "cloudoku-training" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze last 90 days" }));

    expect(await screen.findByText(/no merged PRs in the last 90 days/)).toBeInTheDocument();
  });

  it("deletes a proposal", async () => {
    vi.mocked(api.listFeatures).mockResolvedValue([THREAT]);
    vi.mocked(api.deleteFeature).mockResolvedValue(undefined);

    render(<ReviewStep />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteFeature).toHaveBeenCalledWith("f1"));
  });

  it("adds a manual feature", async () => {
    vi.mocked(api.listFeatures).mockResolvedValue([THREAT]);
    vi.mocked(api.addFeature).mockResolvedValue({ ...THREAT, id: "f2", name: "Manual" });

    render(<ReviewStep />);
    fireEvent.change(await screen.findByLabelText("New feature name"), {
      target: { value: "Manual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addFeature).toHaveBeenCalledWith("Manual"));
  });
});
