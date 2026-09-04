/**
 * The little tile in front of a cost source's name.
 *
 * These are monograms in each provider's colour, not their logos. Shipping real
 * marks would mean either hand-drawing two dozen trademarks from memory — which
 * produces two dozen subtly wrong logos — or a brand-icon package, and the one
 * that exists has no OpenAI, no AWS and no Azure, which would leave the most
 * recognisable rows in the list as the odd ones out. A consistent set of
 * monograms reads as deliberate; a half-set of logos reads as broken.
 *
 * The letters do the identifying and the colour reinforces it, which is why a
 * few of the darker brands can share a family without the list becoming
 * ambiguous.
 */
const MARKS: Record<string, { initials: string; color: string }> = {
  github: { initials: "GH", color: "#24292f" },
  anthropic: { initials: "AN", color: "#d97757" },
  openai: { initials: "OA", color: "#10a37f" },
  google: { initials: "GG", color: "#4285f4" },
  openrouter: { initials: "OR", color: "#64748b" },
  together: { initials: "TA", color: "#4f46e5" },
  fireworks: { initials: "FW", color: "#92661c" },
  bedrock: { initials: "AW", color: "#ff9900" },
  azure: { initials: "AZ", color: "#0078d4" },
  litellm: { initials: "LL", color: "#7e3f8f" },
  vercel: { initials: "VC", color: "#111827" },
  modal: { initials: "MD", color: "#5b8c2a" },
  elevenlabs: { initials: "EL", color: "#334155" },
  groq: { initials: "GQ", color: "#f55036" },
  mistral: { initials: "ML", color: "#fa520f" },
  xai: { initials: "XA", color: "#1f2937" },
  perplexity: { initials: "PX", color: "#1fb8cd" },
  cohere: { initials: "CO", color: "#2b7264" },
  replicate: { initials: "RP", color: "#3f3f46" },
  portkey: { initials: "PK", color: "#857ab8" },
  helicone: { initials: "HL", color: "#c2410c" },
  cursor: { initials: "CU", color: "#4b5563" },
  okta: { initials: "OK", color: "#007dc1" },
  // Both are Microsoft identity products, and share its blue on purpose.
  entra: { initials: "EN", color: "#0078d4" },
};

/** The colour of a source with no mark of its own yet — deliberately a neutral
 *  no brand here uses, so a gap looks like a gap rather than like a choice. */
const UNKNOWN = "#9ca3af";

/** A source with no entry yet: a connector added since, or a self-hosted pool. */
function fallback(name: string) {
  const words = name
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Two words give an initial each; one word gives its first two letters. A
  // name with no letters in it gives neither, and says so rather than echoing
  // whatever punctuation it was made of.
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : words.length === 1 ? words[0].slice(0, 2) : "";
  return { initials: letters.toUpperCase() || "?", color: UNKNOWN };
}

export function ConnectorMark({ type, name }: { type: string; name: string }) {
  const mark = MARKS[type] ?? fallback(name);
  return (
    <span className="connector-mark" style={{ background: mark.color }} aria-hidden>
      {mark.initials}
    </span>
  );
}
