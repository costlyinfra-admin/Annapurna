/**
 * The knowledge base is content, so these tests guard the things that silently
 * rot: dead in-app links, duplicate URLs, and search that stops finding things.
 */
import { describe, expect, it } from "vitest";
import { blockText } from "./blocks";
import { ALL_TOPICS, CATEGORIES, findTopic } from "./content";
import { search } from "./search";

/** Every route the app actually serves. Kept beside App.tsx by these tests. */
const ROUTES = new Set([
  "/",
  "/optimize",
  "/cost-sources",
  "/features",
  "/install-sdk",
  "/alerts",
  "/settings",
  "/help",
]);

const LINKS = /\[[^\]]+\]\(([^)]+)\)/g;

describe("knowledge base content", () => {
  it("has unique slugs, so no topic shadows another", () => {
    const urls = ALL_TOPICS.map(({ category, topic }) => `${category.slug}/${topic.slug}`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length);
  });

  it("links only to routes the app really has", () => {
    // A help system that sends people to a 404 is worse than no help system.
    const bad: string[] = [];
    for (const { category, topic } of ALL_TOPICS) {
      const text = [topic.summary, ...topic.blocks.map(blockText)].join(" ");
      for (const [, href] of text.matchAll(LINKS)) {
        if (!href.startsWith("/")) continue; // external links are not ours to check
        const ok = ROUTES.has(href) || (href.startsWith("/help/") && findTopic(...split(href)));
        if (!ok) bad.push(`${category.slug}/${topic.slug} -> ${href}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives every topic a title, a summary and some body", () => {
    for (const { category, topic } of ALL_TOPICS) {
      const where = `${category.slug}/${topic.slug}`;
      expect(topic.title, where).toBeTruthy();
      expect(topic.summary, where).toBeTruthy();
      expect(topic.blocks.length, where).toBeGreaterThan(0);
    }
  });

  it("covers every area of the product", () => {
    // A reader should be able to look up anything the sidebar offers.
    const all = ALL_TOPICS.map(({ topic }) =>
      [topic.title, topic.summary, ...topic.blocks.map(blockText)].join(" "),
    ).join(" ");
    for (const subject of ["Unattributed", "confidence", "SDK", "alert", "discovery", "customer"]) {
      expect(all.toLowerCase(), subject).toContain(subject.toLowerCase());
    }
  });
});

function split(href: string): [string, string] {
  const [, , category, topic] = href.split("/");
  return [category, topic];
}

describe("knowledge base search", () => {
  it("ignores queries too short to mean anything", () => {
    expect(search("")).toEqual([]);
    expect(search("a")).toEqual([]);
  });

  it("ranks a title match above a passing mention", () => {
    const hits = search("unattributed");
    expect(hits.length).toBeGreaterThan(1); // the term appears in several topics
    expect(hits[0].topic.title).toMatch(/Unattributed/i); // ...but the topic ABOUT it wins
  });

  it("finds topics by their body, not just their title", () => {
    const hits = search("webhook");
    expect(hits.some((h) => h.topic.slug === "delivery")).toBe(true);
  });

  it("returns a readable snippet with each hit", () => {
    const hits = search("cache");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.snippet.length).toBeGreaterThan(0);
      // A reader should never see the inline syntax in a result.
      expect(hit.snippet).not.toContain("**");
      expect(hit.snippet).not.toMatch(/\]\(\//);
    }
  });

  it("finds nothing for a term the book does not cover", () => {
    expect(search("kubernetes helm chart")).toEqual([]);
  });
});
