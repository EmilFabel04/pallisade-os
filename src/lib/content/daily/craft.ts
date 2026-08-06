/* ============================================================
   Craft catalogue — pillars, formats, and the anti-slop rules.

   Sources, per the design doc:
   - Wikipedia:Signs of AI writing (CC BY-SA 4.0)
     https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
     supplies the tell-tale vocabulary and structural patterns.
   - coreyhaines31/marketingskills (MIT)
     https://github.com/coreyhaines31/marketingskills
     supplies the craft rules used by the draft stage.
   ============================================================ */

import { PILLARS, FORMATS, type ContentPillar, type PostFormat } from "./types";

export { PILLARS, FORMATS };

export const PILLAR_META: Record<ContentPillar, { label: string; description: string }> = {
  "client-pain": {
    label: "Client pain",
    description: "A real problem someone described in a call or a pain-point record.",
  },
  "build-log": {
    label: "Build log",
    description:
      "What was shipped and what it now does. A thing that broke belongs here only " +
      "once it is fixed, and the post is about the fix — never a status update on " +
      "something still going wrong.",
  },
  contrarian: {
    label: "Contrarian",
    description: "Where the prevailing AI and automation consensus is wrong.",
  },
  proof: {
    label: "Proof",
    description: "A concrete result carrying a real number that can be verified.",
  },
  teardown: {
    label: "Teardown",
    description: "A broken process pulled apart, and what it should be instead.",
  },
  lesson: {
    label: "Lesson",
    description:
      "Something that went wrong, what it cost, and what he does differently now. " +
      "Told from the far side of it, as expertise another operator can use — never " +
      "as an open wound, and never as a confession.",
  },
};

export const FORMAT_META: Record<PostFormat, { label: string; shape: string }> = {
  scene: {
    label: "Scene",
    shape: "Open inside one specific moment. Let it turn. Land the point last, once.",
  },
  "one-idea": {
    label: "One idea",
    shape: "A single observation, developed properly. No list, no second thought.",
  },
  "before-after": {
    label: "Before / after",
    shape: "The broken way against the fixed way, concrete on both sides of the line.",
  },
  "claim-defence": {
    label: "Claim and defence",
    shape: "A sharp assertion up front, then the reasoning that earns the right to it.",
  },
  numbers: {
    label: "Numbers",
    shape: "Built around real figures. The numbers carry the argument, not adjectives.",
  },
  "short-punch": {
    label: "Short punch",
    shape: "Under 80 words. One blow. Nothing that is not load-bearing.",
  },
};

/** Field-name hints that bias (never decide) Stage 1's pillar choice. */
export const PILLAR_KEYWORDS: { match: RegExp; pillars: ContentPillar[] }[] = [
  { match: /painPoint|objection/i, pillars: ["client-pain", "teardown"] },
  { match: /whatTheySaid|rawNotes/i, pillars: ["client-pain", "contrarian"] },
  { match: /problems|avoidTomorrow/i, pillars: ["lesson", "teardown"] },
  { match: /lessons/i, pillars: ["lesson"] },
  { match: /wins|revenueClosed/i, pillars: ["proof", "build-log"] },
  { match: /currentBlocker|nextAction|deliverables/i, pillars: ["build-log"] },
  { match: /milestone/i, pillars: ["build-log", "proof"] },
  { match: /workaround|possibleSolution/i, pillars: ["teardown", "client-pain"] },
  { match: /buyingSignal/i, pillars: ["contrarian", "proof"] },
  { match: /metric/i, pillars: ["proof"] },
];

/**
 * Single words and fixed phrases that mark machine prose.
 * Matched case-insensitively on word boundaries by gate.ts.
 */
export const AI_TELL_PHRASES: string[] = [
  // Wikipedia:Signs of AI writing — vocabulary
  "delve", "boasts", "tapestry", "testament", "underscore", "underscores",
  "robust", "showcase", "showcases", "pivotal", "crucial", "meticulous",
  "meticulously", "intricate", "intricacies", "foster", "fostering", "garner",
  "enhance", "enhancing", "align with", "resonate with", "valuable insights",
  "evolving landscape", "indelible mark", "deeply rooted", "rich cultural",
  "enduring legacy", "stands as a testament", "plays a significant role",
  "it's important to note", "it is worth remembering",
  "no discussion would be complete", "in today's fast-paced",
  "despite these challenges",
  // LinkedIn-specific extension
  "here's the thing", "let that sink in", "read that again", "game-changer",
  "game changer", "let me explain", "sound familiar", "the result?",
  "i've been thinking a lot about", "unpopular opinion", "hot take",
  "at the end of the day", "moving the needle", "double down",
];

export interface AiTellPattern {
  label: string;
  regex: RegExp;
  detail: string;
}

export const AI_TELL_PATTERNS: AiTellPattern[] = [
  {
    label: "negative parallelism",
    regex: /\b(?:it'?s not (?:just )?[^.?!\n]{2,40}?,?\s*it'?s\b|not only\b[^.?!\n]{2,60}?\bbut\b[^.?!\n]{0,20}?\balso\b|\bno [^,\n]{2,20}, no [^,\n]{2,20}, just\b)/i,
    detail: 'the "It’s not X, it’s Y" construction is the most recognisable AI tic on LinkedIn',
  },
  {
    label: "rule of three",
    regex: /\b([A-Za-z]{5,}), ([A-Za-z]{5,}),? and ([A-Za-z]{5,})\b/,
    detail: "compulsive triplets read as machine-generated — cut it to the one that matters",
  },
  {
    label: "em dash overuse",
    regex: /(?:[^]*—){3}/,
    detail: "three or more em dashes in one post",
  },
  {
    label: "mechanical bolding",
    regex: /(?:[^]*\*\*[^*\n]+\*\*){3}/,
    detail: "three or more bolded runs — LinkedIn posts do not need emphasis scaffolding",
  },
  {
    label: "emoji bullets",
    regex: /^\s*\p{Extended_Pictographic}/mu,
    detail: "emoji used as a list marker",
  },
  {
    label: "inline-header list",
    regex: /^\s*[-*•]\s*\*\*[^*\n]+:\*\*|^\s*[-*•]\s*\*\*[^*\n]+\*\*\s*:/m,
    detail: "the `- **Header:** text` list shape is a chatbot formatting habit",
  },
];

export const ANTI_SLOP_CONSTITUTION = `
HARD RULES. A post that breaks any of these is rejected outright:

1. Never use these constructions: "It's not X, it's Y", "Not only ... but also",
   "no ___, no ___, just ___". They are the clearest tells of machine writing.
2. Never group things in threes for rhythm. If two of the three are filler, cut them.
3. Never use: delve, boasts, tapestry, testament, underscore, robust, showcase,
   pivotal, crucial, meticulous, intricate, foster, garner, enhance, "align with",
   "valuable insights", "here's the thing", "let that sink in", "read that again",
   "game-changer", "at the end of the day", "moving the needle".
4. Never use emoji as bullets. Never bold more than two runs. Never use more than
   two em dashes.
5. Every post must contain at least one concrete, verifiable detail that came from
   the source record: a number, a date, a named industry, or a quoted fragment.
   A post that would still be true if every specific were swapped out is not a post.
   WRITE NUMBERS AS DIGITS — "3 days", not "three days"; "14 hours", not
   "fourteen hours". A spelled-out number cannot be traced back to the record it
   came from, so a post whose only specifics are words counts as having none.
6. Vary sentence length deliberately. Uniform rhythm is the single strongest signal
   of machine prose. Land a short sentence where it hurts.
7. Do not open with a question. Do not close with "What do you think?" or any
   variant. Do not write a one-line paragraph unless the line earns the isolation.
8. Never invent a client name, a number, a quote or a piece of history. If the
   record does not support the detail, write around it or pick different material.
`.trim();

/**
 * The disclosure boundary, stated to the model up front.
 *
 * gate.ts's checkDisclosure enforces this independently and is the actual
 * guarantee — a prompt is a request, not a control. This block exists to keep
 * the revise loop short: a draft that already respects the boundary does not
 * burn its two revisions being told about it.
 *
 * Rule 3 is the one that reads oddly and must not be "tidied" into a general
 * ban on numbers: the gate REQUIRES every post to carry a traceable anchor,
 * and figures from the client's world are usually the only ones available. It
 * is his own commercial position that may never appear, not arithmetic.
 */
export const DISCLOSURE_RULES = `
WHAT MAY NOT BE PUBLISHED. These are not style notes. A post breaking any of
them is rejected regardless of how good it is:

1. Never name a client, a company, or a person he has dealt with. Not the
   business, not the contact, not a detail that identifies either — a niche
   enough description names someone just as surely as the name does. Write "a
   client", "a finance team", "an asset manager" instead.
2. Never quote anyone verbatim as though the words were said to him. Carry the
   substance of what someone meant, not a transcript of how they said it.
3. Never reveal his commercial position. No revenue, no MRR, no pipeline, no
   deal sizes, no client count, no activity numbers (dials, emails, meetings
   booked), and nothing about the stage he is at — "pre-revenue", "my first
   client", "still building", "early days" are all forbidden.
   Figures that belong to the CLIENT's world are not only allowed but wanted:
   "14 hours a month on reconciliation" is the anchor the post needs.
4. Never publish an open difficulty. He may write about something that went
   wrong ONLY from the far side of it — the problem AND the resolution, told
   as expertise someone else can use. "It broke and I'm stuck" is forbidden.
   "Ingest jobs fail on retry when the queue isn't idempotent; here is the
   fix" is exactly right.
5. He is the authority in every post. Never write him as struggling, uncertain,
   learning in public, or asking the reader for reassurance.
`.trim();

export const CRAFT_RULES = `
CRAFT. Adapted from coreyhaines31/marketingskills (MIT).

- Specificity is the whole game. "We increased leads" is forgettable; "we increased
  leads 47% in three weeks" stops the scroll. Reach for the exact figure, the exact
  day, the exact words someone used.
- Write the first line as though the reader has already decided to leave. It earns
  the second line and nothing else.
- One post, one idea. A second idea halves the first.
- Prefer the concrete noun to the abstract one. "Reconciliation spreadsheet" beats
  "manual processes". "Thursday afternoon" beats "recently".
- Show the cost. A problem without a consequence is an observation, not a story.
- Earn the claim before you make it, or make it and then earn it. Never assert and
  move on.
- Cut every sentence that survives only because it sounds professional.
- End on the strongest line available. If the last line is a summary, delete it and
  end on the one before.
`.trim();
