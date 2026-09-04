/**
 * The light/dark switch, in the sidebar footer beside the account controls.
 *
 * One button with two states rather than a light/dark/system picker: until it
 * is pressed the app already follows the operating system, so the third option
 * would be a control for the behaviour you get by not touching anything. The
 * title says what will happen, not what is currently true.
 */
import { useEffect, useState } from "react";
import { apply, resolved, choose, watchSystem, type Theme } from "../theme";

function SunIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => resolved());

  // The inline script in index.html already set this before first paint; this
  // keeps the document in step if the component ever mounts on its own.
  useEffect(() => {
    apply(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => watchSystem(setTheme), []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(choose(next))}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
