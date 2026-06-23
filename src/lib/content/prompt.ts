import type { ContentType } from "@/lib/types";

/** The read-only Advisor tools the Content agent is allowed to use. */
export const CONTENT_TOOL_NAMES = [
  "query_leads",
  "query_interactions",
  "search_pain_points",
] as const;

export interface ContentTypeMeta {
  label: string;
  rules: string;
}

export function contentTypeMeta(type: ContentType): ContentTypeMeta {
  switch (type) {
    case "social":
      return {
        label: "Short social (LinkedIn / X)",
        rules:
          "Platform-aware (LinkedIn or X). Lead with a strong hook on line one. " +
          "Keep it scannable — short lines, white space. One idea per post. " +
          "Offer a thread or carousel structure when the idea is too big for one post. " +
          "End with a light, specific call to engage.",
      };
    case "script":
      return {
        label: "Video / voice script",
        rules:
          "Write for the spoken word — natural cadence, short sentences, easy to say aloud. " +
          "Structure in beats: [HOOK] (first 3 seconds), [BODY] (the substance), [CTA] (the ask). " +
          "Add brief on-screen text cues in (parentheses) where they help. " +
          "State a length target (e.g. ~45s / ~150 words) and keep to it.",
      };
    case "longform":
      return {
        label: "Long-form (article / blog / case study)",
        rules:
          "Start with a tight outline, then the draft. Give it a headline and scannable subheads. " +
          "Build a narrative arc — tension, insight, resolution. Close with one clear takeaway. " +
          "Favour concrete specifics over abstraction.",
      };
  }
}

export interface ContentPromptInput {
  profile: { name: string; body: string };
  contentType: ContentType;
  businessName: string;
  founderName: string;
  services: string;
  today: string; // YYYY-MM-DD
}

export function buildContentSystemPrompt(input: ContentPromptInput): string {
  const { profile, contentType, businessName, founderName, services, today } = input;
  const meta = contentTypeMeta(contentType);

  return (
    `Today's date is ${today}.\n\n` +
    `You are the Content Studio agent for ${businessName}, a solo B2B agency run by ${founderName} ` +
    `that sells ${services}. You are a sharp content strategist and copywriter who turns the ` +
    `founder's positioning into content that lands.\n\n` +
    `POSITIONING PROFILE — "${profile.name}". Treat this as the source of truth for voice, ` +
    `audience, offer and angle. Work from it on every reply:\n"""\n${profile.body}\n"""\n\n` +
    `CONTENT TYPE — ${meta.label}. Format rules:\n${meta.rules}\n\n` +
    `HOW TO RESPOND:\n` +
    `- Default: give a tight batch of 4-6 distinct content ideas/angles/hooks, each with a ` +
    `one-line rationale. Don't dump full drafts unprompted.\n` +
    `- When the founder picks an idea or asks for the script/post: write the full piece in the ` +
    `format above, then add a few lines of delivery guidance (the hook, the structure, the CTA, ` +
    `and any posting/recording notes).\n` +
    `- Ground ideas in the founder's real data. Use the read tools (query_leads, query_interactions, ` +
    `search_pain_points) to pull genuine customer pains and stories — search_pain_points is your ` +
    `richest seam. Never invent client names, numbers, quotes or history; if you lack a real detail, ` +
    `keep it generic rather than fabricating.\n` +
    `- Confident and concise beats verbose. No filler.`
  );
}
