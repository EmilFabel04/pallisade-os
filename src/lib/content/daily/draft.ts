/* Stage 2 — write the post against a brief that has already committed to a
   claim and an anchor. The model's job here is prose, not editorial judgement. */

import type Anthropic from "@anthropic-ai/sdk";
import type { VoiceStats } from "@/lib/content/voice";
import {
  ANTI_SLOP_CONSTITUTION, CRAFT_RULES, DISCLOSURE_RULES, PILLAR_META, FORMAT_META,
} from "./craft";
import type { PostBrief } from "./types";

const MODEL = "claude-sonnet-4-6";

export interface DraftInput {
  brief: PostBrief;
  sourceTexts: string[];
  positioning: string;
  fingerprint: string;
  stats: VoiceStats;
  samples: string[];
  killedExamples: { body: string; reason: string }[];
  editPairs: { before: string; after: string }[];
  neverSay: string[];
}

export function buildVoiceTargets(stats: VoiceStats): string {
  return [
    `- sentence rhythm (burstiness): aim near ${stats.burstiness.toFixed(2)} — this is the`,
    `  single strongest tell. Uniform sentence length reads as machine-written.`,
    `- average sentence: about ${stats.avgSentenceLength.toFixed(0)} words`,
    `- roughly ${(stats.shortSentenceRatio * 100).toFixed(0)}% of sentences under 8 words`,
    `- contractions: about ${stats.contractionRate.toFixed(1)} per 100 words`,
    `- emoji per post: ${stats.emojiPerPost.toFixed(0)}`,
  ].join("\n");
}

/**
 * Sections are assembled as whole blocks and joined with a blank line, rather
 * than as a flat array of lines containing `""` spacers. A flat array has to
 * drop the empty entries to omit an absent optional section, and that also
 * strips every deliberate spacer — running each heading onto the line below
 * its predecessor. `null` marks "this section is absent"; nothing else is
 * filtered, so the blank lines between the sections that ARE present survive.
 */
function joinSections(sections: (string | null)[]): string {
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

export function buildDraftPrompt(input: DraftInput): string {
  const { brief, sourceTexts, positioning, fingerprint, stats, samples } = input;

  const feedback: string[] = [];
  if (input.editPairs.length > 0) {
    feedback.push(
      `POSTS HE REWROTE — the strongest signal you have. Match the "after", not the "before":\n` +
        input.editPairs
          .slice(0, 3)
          .map((p) => `  before: ${p.before}\n  after:  ${p.after}`)
          .join("\n"),
    );
  }
  if (input.killedExamples.length > 0) {
    feedback.push(
      `POSTS HE KILLED — do not write anything like these:\n` +
        input.killedExamples
          .slice(0, 3)
          .map((k) => `  (${k.reason}) ${k.body.slice(0, 200)}`)
          .join("\n"),
    );
  }
  if (input.neverSay.length > 0) {
    feedback.push(`NEVER USE THESE WORDS OR PHRASES: ${input.neverSay.join(", ")}`);
  }

  return joinSections([
    `Write one LinkedIn post for this founder.`,
    `POSITIONING:\n"""\n${positioning}\n"""`,
    `HIS VOICE:\n${fingerprint || "(blunt, concrete, allergic to abstraction)"}`,
    `VOICE TARGETS — measured from what he actually writes:\n${buildVoiceTargets(stats)}`,
    samples.length
      ? `HOW HE SOUNDS:\n${samples.map((s) => `"""\n${s}\n"""`).join("\n")}`
      : null,
    [
      `THE BRIEF — already decided. Do not second-guess it:`,
      `- Pillar: ${brief.pillar} — ${PILLAR_META[brief.pillar].description}`,
      `- Format: ${brief.format} — ${FORMAT_META[brief.format].shape}`,
      `- The claim this post makes: ${brief.claim}`,
      `- The concrete anchor it is built on: ${brief.anchor}`,
    ].join("\n"),
    `THE SOURCE RECORDS — the only facts you may use. Inventing anything is a failure.\n` +
      `They have already been stripped of names; do not reintroduce one, and do not\n` +
      `guess at who is being described:\n` +
      sourceTexts.map((t) => `"""\n${t}\n"""`).join("\n"),
    ANTI_SLOP_CONSTITUTION,
    DISCLOSURE_RULES,
    CRAFT_RULES,
    feedback.length > 0 ? feedback.join("\n\n") : null,
    `Return only the post body. No preamble, no title, no explanation, no hashtags.`,
  ]);
}

function textOf(response: Anthropic.Message): string {
  return (response.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function draftPost(client: Anthropic, input: DraftInput): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildDraftPrompt(input) }],
  });
  return textOf(response as Anthropic.Message);
}

export { textOf };
