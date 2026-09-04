import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so it implements no scrolling. Components that keep a
// view pinned to the newest content call this; stub it rather than making the
// components defensive about a gap that only exists in tests.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// The jsdom build here exposes `localStorage` as a bare object with none of the
// Storage methods on it (`sessionStorage` is real; this one is not). Anything
// that remembers a preference needs a working one, so install a minimal
// in-memory Storage when the environment has not provided a real one.
if (typeof window.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
