/**
 * The "what kind of feature is this?" control, shared by the Features review
 * list and a feature's detail page.
 *
 * The vocabulary comes from the server (/api/features/categories) so the list
 * lives in exactly one place — add a category in discovery.py and it appears
 * here. Choosing one records a USER tag, which no later discovery run overwrites;
 * choosing "Untagged" clears it and hands the feature back to the guess.
 */
import { useEffect, useState } from "react";
import { api } from "../api";

/** Cached across mounts — the vocabulary is small and never changes per user. */
let cached: { value: string; label: string }[] | null = null;

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (category: string | null) => Promise<void> | void;
}) {
  const [options, setOptions] = useState(cached);

  useEffect(() => {
    if (cached) return;
    let active = true;
    api
      .featureCategories()
      .then((d) => {
        cached = d.categories;
        if (active) setOptions(d.categories);
      })
      .catch(() => active && setOptions([]));
    return () => {
      active = false;
    };
  }, []);

  return (
    <select
      className="category-picker"
      aria-label="Feature type"
      title="Which part of the product this feature belongs to. Your tag is kept — re-running discovery won't change it."
      value={value ?? ""}
      disabled={options === null}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Untagged</option>
      {(options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
