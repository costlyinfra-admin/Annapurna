import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectorMark } from "./ConnectorMark";
import { CONNECTOR_GUIDES } from "../connectorGuides";

const mark = () => document.querySelector(".connector-mark") as HTMLElement;

describe("ConnectorMark", () => {
  it("gives a known provider its own initials and colour", () => {
    render(<ConnectorMark type="openai" name="OpenAI" />);
    expect(mark()).toHaveTextContent("OA");
    expect(mark()).toHaveStyle({ background: "#10a37f" });
  });

  it("is decoration, not something a screen reader reads out", () => {
    // The provider's name sits right beside it; hearing "O A" first is noise.
    render(<ConnectorMark type="openai" name="OpenAI" />);
    expect(mark()).toHaveAttribute("aria-hidden");
  });

  it("covers every provider that has a setup guide", () => {
    // A connector shipped without a mark falls back to grey initials, which
    // looks like an oversight next to two dozen coloured ones — because it is.
    for (const type of Object.keys(CONNECTOR_GUIDES)) {
      const { unmount } = render(<ConnectorMark type={type} name={type} />);
      expect(mark(), `no mark for ${type}`).not.toHaveStyle({ background: "#9ca3af" });
      unmount();
    }
  });

  it("still shows something for a provider it has never heard of", () => {
    render(<ConnectorMark type="brand-new" name="Brand New" />);
    expect(mark()).toHaveTextContent("BN");
  });

  it("copes with a name that has no second word or no letters", () => {
    const { unmount } = render(<ConnectorMark type="x" name="Modal" />);
    expect(mark()).toHaveTextContent("MO");
    unmount();
    render(<ConnectorMark type="y" name="—" />);
    expect(mark()).toHaveTextContent("?");
  });
});
