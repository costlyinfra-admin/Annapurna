/**
 * The logo in front of a cost source's name.
 *
 * The marks are the providers' own, used to identify their connector — the
 * ordinary way an integration list names the things it integrates with. They
 * came from svgl, simple-icons and @lobehub/icons (all permissively licensed
 * collections; the marks themselves remain their owners'). Three of them —
 * LiteLLM, Portkey and Helicone — publish no SVG at all, so those are their
 * favicons instead, which is why the map allows both extensions.
 *
 * The list is derived from the files rather than written out, so adding a logo
 * is adding a file: `src/logos/<connector type>.svg`. A type with no file falls
 * back to a monogram, which is what a self-hosted pool or a connector added
 * since gets.
 */
const FILES = import.meta.glob("../logos/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** connector type -> the emitted URL of its logo. */
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.\w+$/, "$1"), url]),
);

/** Initials for a source with no logo: two words give an initial each, one word
 *  gives its first two letters, and a name with no letters gives neither. */
function initialsFor(name: string): string {
  const words = name
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : words.length === 1 ? words[0].slice(0, 2) : "";
  return letters.toUpperCase() || "?";
}

export function ConnectorMark({ type, name }: { type: string; name: string }) {
  const logo = LOGOS[type];
  if (logo) {
    // Empty alt, not the provider's name: the name is the very next thing in
    // the row, and hearing it twice helps nobody.
    return (
      <span className="connector-mark logo">
        <img src={logo} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className="connector-mark" aria-hidden>
      {initialsFor(name)}
    </span>
  );
}
