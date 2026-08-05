/* The prose half of the voice profile. The numeric half is measured in
   voice.ts; this describes what the numbers cannot. */

import type Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

export const FINGERPRINT_SCHEMA: Anthropic.Tool = {
  name: "submit_fingerprint",
  description: "Submit a voice fingerprint derived from the writing samples.",
  input_schema: {
    type: "object",
    properties: {
      fingerprint: {
        type: "string",
        description:
          "150-250 words describing how this person writes: cadence, diction, " +
          "stance, recurring habits, what they do at the start and end of a piece. " +
          "Be specific enough that another writer could imitate it.",
      },
      neverSay: {
        type: "array",
        items: { type: "string" },
        description:
          "Words and phrases this person would obviously never write, inferred " +
          "from what is conspicuously absent. 5-15 entries, lowercase.",
      },
    },
    required: ["fingerprint", "neverSay"],
  },
};

export function buildFingerprintPrompt(samples: string[]): string {
  return [
    `Below are things one person wrote. Work out how they write.`,
    ``,
    ...samples.map((s, i) => `SAMPLE ${i + 1}:\n"""\n${s}\n"""`),
    ``,
    `Describe the voice: rhythm and cadence, diction, stance towards the reader,`,
    `how they open, how they close, what they consistently refuse to do.`,
    ``,
    `Then list words and phrases this person would never say — infer them from what`,
    `is conspicuously absent. If they never reach for corporate abstraction, say so`,
    `and name the specific words they would avoid.`,
    ``,
    `Call submit_fingerprint.`,
  ].join("\n");
}

export async function generateFingerprint(
  client: Anthropic,
  samples: string[],
): Promise<{ fingerprint: string; neverSay: string[] }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [FINGERPRINT_SCHEMA],
    tool_choice: { type: "tool", name: "submit_fingerprint" },
    messages: [{ role: "user", content: buildFingerprintPrompt(samples) }],
  });

  const block = ((response as Anthropic.Message).content ?? []).find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_fingerprint",
  );
  if (!block) throw new Error("fingerprint_failed: model did not call submit_fingerprint");

  const input = block.input as { fingerprint?: string; neverSay?: string[] };
  return {
    fingerprint: input.fingerprint ?? "",
    // Lowercased because gate.ts's checkNeverSay lowercases the body before
    // matching — an entry stored as "Leverage" would never fire.
    neverSay: (input.neverSay ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
  };
}
