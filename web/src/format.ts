const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format a dollar amount; whole dollars, or cents when small. `null` -> em dash. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.abs(value) < 100 ? USD_CENTS.format(value) : USD.format(value);
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

/** Whole-dollar amount, never cents — for compact axis/bar labels. `null` -> em dash. */
export function wholeMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return USD.format(value);
}

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact count, e.g. 320,000 -> "320K". `null` -> em dash (unknown). */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return COMPACT.format(value);
}

/** Short local date-time, e.g. "Jul 19, 3:42 PM" — used in the admin portal. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "claude_code" -> "Claude Code". A display label for coding-tool ids. */
export function prettyTool(tool: string): string {
  return tool
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
