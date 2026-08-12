/* Stage 1 — choose the day's two angles and commit to them in structured
   form BEFORE any prose exists. This is the stage that kills generic: a post
   cannot be written unless there is a specific claim tied to a specific real
   detail from a specific record. */

import type Anthropic from "@anthropic-ai/sdk";
import {
  PILLARS, FORMATS,
  type ContentPillar, type PostFormat, type MaterialItem, type PostBrief,
} from "./types";
import { PILLAR_META, FORMAT_META, DISCLOSURE_RULES } from "./craft";
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

/**
 * What the model may still choose today.
 *
 * Derived from the same memory validateBriefs judges against, so the menu the
 * model is offered and the rule it is graded by cannot drift apart. Both the
 * prompt and the tool schema are built from this — a blocked pillar is never
 * presented as an option and the enum will not accept one, which is stronger
 * than asking the model not to pick it. buildMemory guarantees at least
 * CHOICES_NEEDED of each remains.
 */
export function allowedChoices(memory: RotationMemory): {
  pillars: ContentPillar[];
  formats: PostFormat[];
} {
  return {
    pillars: PILLARS.filter((p) => !memory.recentPillars.has(p)),
    formats: FORMATS.filter((f) => !memory.recentFormats.has(f)),
  };
}

export function briefSchema(memory: RotationMemory): Anthropic.Tool {
  const { pillars, formats } = allowedChoices(memory);
  return {
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
            pillar: { type: "string", enum: pillars },
            format: { type: "string", enum: formats },
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
}

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

  // Only the still-choosable options are catalogued. Listing all six and then
  // naming the blocked ones separately asks the model to subtract one list
  // from another, and on 2026-08-12 it simply did not — it picked two pillars
  // and two formats the prompt had already named as blocked, twice running.
  // An option that is not on the menu cannot be ordered.
  const { pillars: okPillars, formats: okFormats } = allowedChoices(memory);
  const pillars = okPillars.map((p) => `- ${p}: ${PILLAR_META[p].description}`).join("\n");
  const formats = okFormats.map((f) => `- ${f}: ${FORMAT_META[f].shape}`).join("\n");

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
    `AVAILABLE MATERIAL — everything below is real and logged. You may not use anything`,
    `else. Names have already been stripped out of it; an angle that only works if the`,
    `reader knows who is involved is not an angle you may choose:`,
    material || "(nothing available)",
    ``,
    // Stage 1 gets the boundary too, so an exposing angle is never CHOSEN. A
    // brief committing to "the day I nearly ran out of money" cannot be
    // rescued by the draft stage — the claim itself is the disclosure.
    DISCLOSURE_RULES,
    ``,
    `PILLARS — the complete set you may choose from today:\n${pillars}`,
    ``,
    `FORMATS — the complete set you may choose from today:\n${formats}`,
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

function briefToolUse(response: Anthropic.Message): Anthropic.ToolUseBlock {
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_briefs",
  );
  if (!block) throw new Error("brief_invalid: model did not call submit_briefs");
  return block;
}

function briefsFrom(block: Anthropic.ToolUseBlock): PostBrief[] {
  const briefs = (block.input as { briefs?: PostBrief[] }).briefs;
  if (!Array.isArray(briefs) || briefs.length !== 2) {
    throw new Error("brief_invalid: expected exactly two briefs");
  }
  return briefs;
}

/**
 * The corrective turn that follows a replayed assistant tool_use.
 *
 * It MUST be tool_result blocks, not prose: the API rejects the entire
 * request with a 400 ("`tool_use` ids were found without `tool_result`
 * blocks immediately after") when an assistant turn carrying a tool_use is
 * answered by a plain-text user turn. That 400 reached the founder as a 502
 * on every regeneration — regenerating a day that already has posts is
 * exactly the case where rotation memory is fullest and a violation, and so
 * this retry, is near certain.
 *
 * EVERY tool_use in the replayed turn is answered, not just submit_briefs.
 * The forced tool_choice makes a second block unlikely, but the API's
 * requirement is total: one unanswered id fails the whole request.
 */
function correctionTurn(
  response: Anthropic.Message,
  violations: string[],
): Anthropic.MessageParam {
  const feedback =
    `Those briefs break the rotation rules:\n` +
    violations.map((v) => `- ${v}`).join("\n") +
    `\n\nChoose again, respecting every constraint.`;

  const results = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      type: "tool_result" as const,
      tool_use_id: b.id,
      is_error: true,
      content: b.name === "submit_briefs" ? feedback : "Ignored — call submit_briefs.",
    }));

  return { role: "user", content: results };
}

export async function chooseBriefs(
  client: Anthropic,
  input: BriefPromptInput,
  memory: RotationMemory,
): Promise<PostBrief[]> {
  const prompt = buildBriefPrompt(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  // Built from the same memory the briefs are validated against, so the enum
  // the model must satisfy and the rule it is graded by are one source.
  const schema = briefSchema(memory);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [schema],
      tool_choice: { type: "tool", name: "submit_briefs" },
      messages,
    });

    const message = response as Anthropic.Message;
    const briefs = briefsFrom(briefToolUse(message));
    const violations = validateBriefs(briefs, memory);
    if (violations.length === 0) return briefs;

    if (attempt === 1) {
      throw new Error(`brief_invalid: ${violations.join(" | ")}`);
    }

    messages.push({ role: "assistant", content: message.content });
    messages.push(correctionTurn(message, violations));
  }

  throw new Error("brief_invalid: exhausted retries");
}
