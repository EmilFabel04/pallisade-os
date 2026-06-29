import type { NewsInterests, NewsItem } from "@/lib/types";

/** System prompt for the curation pass. Embeds the interests profile and the
 *  already-fetched structured items so Claude ranks them and fills gaps. */
export function buildNewsSystemPrompt(params: {
  interests: NewsInterests;
  today: string;
  items: NewsItem[];
}): string {
  const { interests, today, items } = params;
  const itemLines = items
    .map((i) => `- [${i.id}] (${i.category}) ${i.title} — ${i.source}${i.snippet ? ` — ${i.snippet.slice(0, 120)}` : ""}`)
    .join("\n");

  return [
    `You are the news curator inside Pallisade OS. Today is ${today}.`,
    ``,
    `THE FOUNDER:`,
    interests.aboutMe,
    ``,
    `THEIR INTERESTS: ${interests.topics}`,
    ``,
    `You are given a list of already-fetched items (GitHub repos, Reddit posts, RSS articles).`,
    `Your job:`,
    `1. Use web_search to find a FEW high-signal extra items the founder would care about, focused on`,
    `   X/Twitter chatter and "cool things people are building/sharing" not already in the list.`,
    `2. Pick the most relevant items overall and write a one-line "why this matters to you" for each (max ~12 words).`,
    `3. Write a short markdown "Top Picks" summary (3-6 bullets) of what's most worth their time today.`,
    `Finally, call the submit_news tool exactly once with your result. Do not write a normal text reply.`,
    ``,
    `ALREADY-FETCHED ITEMS (reference picks by their [id]):`,
    itemLines || "(none)",
  ].join("\n");
}
