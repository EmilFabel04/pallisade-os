/* Stage 4 — fix named defects. The model never receives "make it better";
   it receives the specific rule that failed and why. */

import type Anthropic from "@anthropic-ai/sdk";
import { buildDraftPrompt, textOf, type DraftInput } from "./draft";
import type { EditorialCheck } from "./types";

const MODEL = "claude-sonnet-4-6";

export interface ReviseInput extends DraftInput {
  body: string;
  failures: EditorialCheck[];
}

export function buildRevisePrompt(input: ReviseInput): string {
  // The whole draft prompt is carried through, not just the defect list: a
  // revision that has forgotten the claim, the anchor, the source records and
  // the never-say list can repair one rule while breaking another.
  return [
    buildDraftPrompt(input),
    ``,
    `YOU ALREADY WROTE THIS DRAFT:`,
    `"""\n${input.body}\n"""`,
    ``,
    `IT FAILED THESE CHECKS:`,
    ...input.failures.map((f) => `- [${f.rule}] ${f.detail}`),
    ``,
    `Fix exactly those defects. Keep the same claim and the same anchor. Do not`,
    `rewrite from scratch and do not introduce a new angle — only repair what failed.`,
    `Return only the corrected post body.`,
  ].join("\n");
}

export async function revisePost(client: Anthropic, input: ReviseInput): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildRevisePrompt(input) }],
  });
  return textOf(response as Anthropic.Message);
}
