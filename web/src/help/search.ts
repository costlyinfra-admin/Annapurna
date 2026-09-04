/**
 * Knowledge-base search.
 *
 * Small enough to run over the whole book on every keystroke, so there is no
 * index to build or keep in sync. Ranking is deliberately simple and
 * explainable: a title match beats a summary match beats a body match, because
 * someone typing "webhook" wants the topic *about* webhooks, not the four topics
 * that mention one in passing.
 */
import { blockText, stripInline } from "./blocks";
import { ALL_TOPICS, type Category, type Topic } from "./content";

export interface Hit {
  category: Category;
  topic: Topic;
  /** A short excerpt around the match, for the result list. */
  snippet: string;
}

const SNIPPET = 150;

function excerpt(body: string, query: string): string {
  const at = body.toLowerCase().indexOf(query);
  if (at < 0) return body.slice(0, SNIPPET).trim();
  const from = Math.max(0, at - 60);
  const text = body.slice(from, from + SNIPPET).trim();
  return (from > 0 ? "…" : "") + text + (from + SNIPPET < body.length ? "…" : "");
}

export function search(raw: string): Hit[] {
  const query = raw.trim().toLowerCase();
  if (query.length < 2) return [];

  const scored: { hit: Hit; score: number }[] = [];
  for (const { category, topic } of ALL_TOPICS) {
    const body = topic.blocks.map(blockText).join(" ");
    const title = topic.title.toLowerCase();
    const summary = topic.summary.toLowerCase();

    let score = 0;
    if (title.includes(query)) score += 100;
    if (summary.includes(query)) score += 20;
    if (body.toLowerCase().includes(query)) score += 5;
    if (category.title.toLowerCase().includes(query)) score += 3;
    if (!score) continue;

    scored.push({
      hit: {
        category,
        topic,
        snippet: excerpt(summary.includes(query) ? stripInline(topic.summary) : body, query),
      },
      score,
    });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.hit);
}
