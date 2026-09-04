import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so it implements no scrolling. Components that keep a
// view pinned to the newest content call this; stub it rather than making the
// components defensive about a gap that only exists in tests.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
