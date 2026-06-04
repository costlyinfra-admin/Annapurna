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
