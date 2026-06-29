import type Anthropic from "@anthropic-ai/sdk";
import type { NewsCategory, NewsFeedData, NewsInterests, NewsItem } from "@/lib/types";
import { itemId, dedupeItems } from "./normalize";
import { buildNewsSystemPrompt } from "./prompt";

const MAX_ITERATIONS = 6;
const CATEGORIES: NewsCategory[] = ["github", "ai", "finance", "products", "reddit", "x"];

export interface Submission {
  summary: string;
  picks: { id: string; whyItMatters: string }[];
  extra: { title: string; url: string; source: string; category: NewsCategory; snippet: string }[];
}

/** The terminal tool the model calls once with its curated result. */
export const SUBMIT_NEWS_TOOL = {
  name: "submit_news",
  description: "Submit the final curated news: a markdown top-picks summary, per-item blurbs, and any extra items found via search.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Markdown 'Top Picks' summary, 3-6 bullets." },
      picks: {
        type: "array",
        description: "Relevance blurbs for the most important already-fetched items.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "the [id] of an already-fetched item" },
            whyItMatters: { type: "string", description: "one line, max ~12 words" },
          },
          required: ["id", "whyItMatters"],
        },
      },
      extra: {
        type: "array",
        description: "New items found via web_search (esp. X chatter / cool builds).",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            source: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            snippet: { type: "string" },
          },
          required: ["title", "url", "source", "category", "snippet"],
        },
      },
    },
    required: ["summary", "picks", "extra"],
  },
};

/** No-AI feed: structured items as-is, no summary. */
export function buildStructuredFeed(
  items: NewsItem[],
  degraded: string[],
  fetchedAt: string,
): NewsFeedData {
  return { items, summary: "", fetchedAt, degraded };
}

/** Merge Claude's submission into the structured items. */
export function applySubmission(
  items: NewsItem[],
  submission: Submission,
  degraded: string[],
  fetchedAt: string,
): NewsFeedData {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  for (const p of submission.picks ?? []) {
    const it = byId.get(p.id);
    if (it) it.whyItMatters = p.whyItMatters;
  }
  const extras: NewsItem[] = (submission.extra ?? [])
    .filter((e) => /^https?:\/\//.test(e.url) && e.title)
    .map((e) => ({
      id: itemId(e.url),
      title: e.title,
      url: e.url,
      source: e.source || "web",
      category: CATEGORIES.includes(e.category) ? e.category : "x",
      snippet: e.snippet ?? "",
      publishedAt: null,
    }));
  return {
    items: dedupeItems([...byId.values(), ...extras]),
    summary: submission.summary ?? "",
    fetchedAt,
    degraded,
  };
}

/** Run the curation tool-loop. Falls back to the structured feed on any failure. */
export async function curate(params: {
  client: Anthropic;
  model: string;
  interests: NewsInterests;
  items: NewsItem[];
  degraded: string[];
  today: string;
  fetchedAt: string;
}): Promise<NewsFeedData> {
  const { client, model, interests, items, degraded, today, fetchedAt } = params;
  const system = buildNewsSystemPrompt({ interests, today, items });
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    SUBMIT_NEWS_TOOL,
  ] as unknown as Anthropic.Tool[];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Curate today's news for me." },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await client.messages.create({ model, max_tokens: 4096, system, tools, messages });

      const submit = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_news",
      );
      if (submit) return applySubmission(items, submit.input as Submission, degraded, fetchedAt);

      // web_search runs server-side and may pause; resume by re-sending.
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      if (res.stop_reason !== "tool_use") break;
      // Any other tool_use (only web_search exists server-side) — just continue the loop.
      messages.push({ role: "assistant", content: res.content });
    }
  } catch {
    /* fall through to structured feed */
  }
  return buildStructuredFeed(items, degraded, fetchedAt);
}
