import type { NewsCategory, NewsInterests } from "@/lib/types";
import type { Tone } from "@/lib/badges";

/** Seeded on first visit; the user edits it in the interests modal. */
export const DEFAULT_NEWS_INTERESTS: Omit<
  NewsInterests,
  "id" | "createdAt" | "updatedAt"
> = {
  topics: "AI agents, RAG, LLM tooling, developer tools, B2B SaaS, automation",
  githubLanguages: "TypeScript, Python",
  githubTopics: "llm, agents, rag, ai",
  subreddits: "MachineLearning, LocalLLaMA, SaaS, Entrepreneur",
  rssFeeds: [
    "ai|https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "finance|https://www.moneyweb.co.za/feed/",
    "products|https://news.ycombinator.com/rss",
  ].join("\n"),
  aboutMe:
    "Solo B2B agency founder in South Africa building bespoke AI systems, " +
    "automation and custom software for boutique asset managers and B2B service businesses.",
};

export const CATEGORY_ORDER: NewsCategory[] = [
  "github",
  "ai",
  "finance",
  "products",
  "reddit",
  "x",
];

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  github: "GitHub",
  ai: "AI News",
  finance: "SA Finance",
  products: "Products & Tricks",
  reddit: "Reddit",
  x: "X",
};

export function categoryTone(c: NewsCategory): Tone {
  switch (c) {
    case "github": return "info";
    case "ai": return "accent";
    case "finance": return "positive";
    case "products": return "warning";
    case "reddit": return "neutral";
    case "x": return "muted";
    default: return "neutral";
  }
}
