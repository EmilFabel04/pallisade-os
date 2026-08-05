/* Stage 1 — choose the day's two angles and commit to them in structured
   form BEFORE any prose exists. This is the stage that kills generic: a post
   cannot be written unless there is a specific claim tied to a specific real
   detail from a specific record. */

import type Anthropic from "@anthropic-ai/sdk";
import { PILLARS, FORMATS, type MaterialItem, type PostBrief } from "./types";
import { PILLAR_META, FORMAT_META } from "./craft";
import {
  validateBriefs, type RotationMemory,
  PILLAR_WINDOW_DAYS, FORMAT_WINDOW_DAYS, SOURCE_WINDOW_DAYS,
} from "./rotation";

export interface BriefPromptInput {
  ledger: MaterialItem[];
  memory: RotationMemory;
  positioning: string;
  fingerprint: string;
  today: string;
}

export const BRIEF_SCHEMA: Anthropic.Tool = {
  name: "submit_briefs",
  description: "Submit exactly two post briefs for today.",
  input_schema: {
    type: "object",
    properties: {
      briefs: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            slot: { type: "integer", enum: [1, 2] },
            pillar: { type: "string", enum: [...PILLARS] },
            format: { type: "string", enum: [...FORMATS] },
            claim: {
              type: "string",
              description:
                "The single thing this post asserts, in one sentence. Must be falsifiable.",
            },
            anchor: {
              type: "string",
              description:
                "The exact concrete detail from the source record the post is built on.",
            },
            why: { type: "string", description: "Why this is worth a post today." },
            sourceRefs: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  collection: { type: "string" },
                  id: { type: "string" },
                  anchor: { type: "string" },
                },
                required: ["collection", "id", "anchor"],
              },
            },
          },
          required: ["slot", "pillar", "format", "claim", "anchor", "why", "sourceRefs"],
        },
      },
    },
    required: ["briefs"],
  },
};

export function buildBriefPrompt(input: BriefPromptInput): string {
  const { ledger, memory, positioning, fingerprint, today } = input;

  const material = ledger
    .slice(0, 12)
    .map(
      (i, n) =>
        `${n + 1}. ${i.collection}/${i.id} (${i.date || "undated"})\n` +
        `   "${i.text.slice(0, 300)}"\n` +
        `   anchors: ${i.anchors.length ? i.anchors.join(", ") : "none — weak material"}\n` +
        `   suggests: ${i.pillarHints.join(", ") || "no hint"}`,
    )
    .join("\n\n");

  const pillars = PILLARS.map((p) => `- ${p}: ${PILLAR_META[p].description}`).join("\n");
  const formats = FORMATS.map((f) => `- ${f}: ${FORMAT_META[f].shape}`).join("\n");

  const blockedPillars = [...memory.recentPillars.entries()]
    .map(([p, d]) => `${p} (used ${d})`).join(", ") || "none";
  const blockedFormats = [...memory.recentFormats.entries()]
    .map(([f, d]) => `${f} (used ${d})`).join(", ") || "none";
  const blockedSources = [...memory.recentSources.keys()].join(", ") || "none";

  return [
    `Today is ${today}. You are choosing the two LinkedIn posts this founder will publish.`,
    ``,
    `POSITIONING — the source of truth for audience, offer and angle:`,
    `"""\n${positioning}\n"""`,
    ``,
    `THE FOUNDER'S VOICE:`,
    fingerprint || "(not yet fingerprinted — assume blunt and concrete)",
    ``,
    `AVAILABLE MATERIAL — everything below is real and logged. You may not use anything else:`,
    material || "(nothing available)",
    ``,
    `PILLARS:\n${pillars}`,
    ``,
    `FORMATS:\n${formats}`,
    ``,
    `HARD CONSTRAINTS — a brief breaking any of these is rejected and you will be asked again:`,
    `- Pillars used within the last ${PILLAR_WINDOW_DAYS} days and therefore blocked: ${blockedPillars}`,
    `- Formats used within the last ${FORMAT_WINDOW_DAYS} days and therefore blocked: ${blockedFormats}`,
    `- Source records used within the last ${SOURCE_WINDOW_DAYS} days and therefore blocked: ${blockedSources}`,
    `- The two briefs must differ in BOTH pillar and format.`,
    ``,
    `FOR EACH SLOT:`,
    `- Pick the material with the most at stake, not the most recent.`,
    `- Write a claim: the one falsifiable thing the post asserts. "Manual work is bad"`,
    `  is not a claim. "The reconciliation nobody owned cost them 14 hours a month`,
    `  because two systems already held the same numbers" is a claim.`,
    `- Name the anchor: the exact concrete detail from the record the post is built on.`,
    `  A number, a date, a named industry, or words someone actually said.`,
    `- If a candidate has no anchor, it is weak material. Prefer one that does.`,
    ``,
    `Call submit_briefs with exactly two briefs.`,
  ].join("\n");
}

const MODEL = "claude-sonnet-4-6";

function extractBriefs(response: Anthropic.Message): PostBrief[] {
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_briefs",
  );
  if (!block) throw new Error("brief_invalid: model did not call submit_briefs");
  const briefs = (block.input as { briefs?: PostBrief[] }).briefs;
  if (!Array.isArray(briefs) || briefs.length !== 2) {
    throw new Error("brief_invalid: expected exactly two briefs");
  }
  return briefs;
}

export async function chooseBriefs(
  client: Anthropic,
  input: BriefPromptInput,
  memory: RotationMemory,
): Promise<PostBrief[]> {
  const prompt = buildBriefPrompt(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [BRIEF_SCHEMA],
      tool_choice: { type: "tool", name: "submit_briefs" },
      messages,
    });

    const briefs = extractBriefs(response as Anthropic.Message);
    const violations = validateBriefs(briefs, memory);
    if (violations.length === 0) return briefs;

    if (attempt === 1) {
      throw new Error(`brief_invalid: ${violations.join(" | ")}`);
    }

    messages.push({ role: "assistant", content: (response as Anthropic.Message).content });
    messages.push({
      role: "user",
      content:
        `Those briefs break the rotation rules:\n` +
        violations.map((v) => `- ${v}`).join("\n") +
        `\n\nChoose again, respecting every constraint.`,
    });
  }

  throw new Error("brief_invalid: exhausted retries");
}
