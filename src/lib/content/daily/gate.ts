/* The anti-slop gate. Pure, no model calls.

   Every failure returns a specific, actionable detail. "Make it better" is
   never sent back to the model — the revise stage gets a named defect list. */

import { measure, compare, splitParagraphs, splitSentences, type VoiceStats } from "@/lib/content/voice";
import { AI_TELL_PHRASES, AI_TELL_PATTERNS } from "./craft";
import { extractAnchors } from "./anchors";
import type { EditorialCheck, SourceRef } from "./types";

export const BROETRY_THRESHOLD = 0.6;

export interface GateInput {
  body: string;
  sourceRefs: SourceRef[];
  /** Raw text of every record cited in sourceRefs, for anchor tracing. */
  sourceTexts: string[];
  profile: VoiceStats;
  neverSay: string[];
  recentOpeners: string[];
}

/** Strip case, punctuation and digits so two openers of the same shape collide. */
export function normaliseOpener(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\w\s#]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

function ok(rule: string, detail: string): EditorialCheck {
  return { rule, passed: true, detail };
}
function fail(rule: string, detail: string): EditorialCheck {
  return { rule, passed: false, detail };
}

function checkAiTells(body: string): EditorialCheck {
  const lower = body.toLowerCase();
  const hits: string[] = [];

  for (const phrase of AI_TELL_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) hits.push(`"${phrase}"`);
  }
  for (const pattern of AI_TELL_PATTERNS) {
    if (pattern.regex.test(body)) hits.push(`${pattern.label} — ${pattern.detail}`);
  }

  return hits.length === 0
    ? ok("ai-tells", "no machine-writing tells")
    : fail("ai-tells", hits.join("; "));
}

function checkSpecificity(input: GateInput): EditorialCheck {
  const anchors = extractAnchors(input.body);
  if (anchors.length === 0) {
    return fail(
      "specificity",
      "no verifiable detail — the post would still read the same with every " +
        "specific swapped out, which makes it unfalsifiable",
    );
  }

  const haystack = input.sourceTexts.join(" \n ").toLowerCase();
  const refAnchors = input.sourceRefs.map((r) => r.anchor.toLowerCase());
  const traced = anchors.filter(
    (a) => haystack.includes(a.toLowerCase()) || refAnchors.includes(a.toLowerCase()),
  );

  return traced.length > 0
    ? ok("specificity", `anchored on ${traced.slice(0, 3).join(", ")}`)
    : fail(
        "specificity",
        `none of ${anchors.slice(0, 3).join(", ")} appears in the cited records — ` +
          "either it was invented or the wrong source is attached",
      );
}

function checkBroetry(body: string): EditorialCheck {
  const paragraphs = splitParagraphs(body);
  if (paragraphs.length < 3) {
    return ok("broetry", "too short to judge paragraph rhythm");
  }
  const singles = paragraphs.filter((p) => splitSentences(p).length === 1).length;
  const ratio = singles / paragraphs.length;

  return ratio > BROETRY_THRESHOLD
    ? fail(
        "broetry",
        `${singles} of ${paragraphs.length} paragraphs are a single sentence — ` +
          "the one-line-per-thought shape reads as LinkedIn filler",
      )
    : ok("broetry", `${singles} of ${paragraphs.length} paragraphs are single-sentence`);
}

function checkOpener(body: string, recentOpeners: string[]): EditorialCheck {
  const opener = splitSentences(body)[0] ?? "";
  const shape = normaliseOpener(opener);
  if (!shape) return ok("opener-collision", "no opening line to compare");

  const clash = recentOpeners.find((o) => normaliseOpener(o) === shape);
  return clash
    ? fail("opener-collision", `opens in the same shape as a recent post: "${clash}"`)
    : ok("opener-collision", "opening line is unlike the last 30");
}

function checkNeverSay(body: string, neverSay: string[]): EditorialCheck {
  const lower = body.toLowerCase();
  const hits = neverSay.filter((p) => p.trim() && lower.includes(p.toLowerCase().trim()));
  return hits.length === 0
    ? ok("never-say", "avoids everything on your never-say list")
    : fail("never-say", `uses ${hits.map((h) => `"${h}"`).join(", ")}, which you have killed before`);
}

function checkBurstiness(body: string, profile: VoiceStats): EditorialCheck {
  const stats = measure(body);
  const drift = compare(stats, profile).find((d) => d.metric === "burstiness");
  return drift
    ? fail("burstiness", drift.detail)
    : ok("burstiness", `rhythm ${stats.burstiness.toFixed(2)} against your ${profile.burstiness.toFixed(2)}`);
}

export function runGate(input: GateInput): EditorialCheck[] {
  return [
    checkAiTells(input.body),
    checkSpecificity(input),
    checkBroetry(input.body),
    checkOpener(input.body, input.recentOpeners),
    checkNeverSay(input.body, input.neverSay),
    checkBurstiness(input.body, input.profile),
  ];
}
