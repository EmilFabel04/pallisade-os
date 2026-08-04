# Content Studio Daily Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two grounded, non-generic LinkedIn posts every morning at 06:00 SAST without the founder prompting for them.

**Architecture:** A five-stage pipeline — harvest (pure) → brief (model, JSON) → draft (model) → gate (pure) → revise (model, only on failure) — driven by a Vercel cron job. The quality argument lives entirely in the pure stages: material selection, rotation guardrails and anti-slop checks are deterministic code with real tests, not prompt instructions the model may ignore. Server-authored data (`contentPosts`, `contentRuns`) is deliberately kept out of the client's full-replace snapshot to avoid a stale tab wiping cron output.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@anthropic-ai/sdk`, `@libsql/client` (SQLite local / Turso prod), Vitest, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-08-04-content-studio-daily-engine-design.md](../specs/2026-08-04-content-studio-daily-engine-design.md)

## Global Constraints

- Model: `claude-sonnet-4-6` — matches `src/app/api/content/route.ts:11`. Do not change it.
- Routes calling libSQL or the Anthropic SDK must declare `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- No new npm dependencies. `write-good`, `retext`, `proselint`, `alex` and Vale were considered and rejected in the spec.
- Test runner is Vitest: `npm test` runs once, `npm run test:watch` watches. Test files live beside their subject as `<name>.test.ts`.
- Route error responses use `apiError(code, status, cause)` from `src/lib/api/errors.ts`. Never return a raw error message.
- Cron target time is **06:00 SAST = 04:00 UTC**.
- Rotation windows, copied verbatim from the spec: pillar **4 days**, format **3 days**, source record **21 days**, opening-line history **30 posts**, `neverSay` cap **60 entries**.
- Broetry threshold: more than **60%** of paragraphs being a single sentence.
- `metricEntries` qualify as material only when a value differs from its trailing 7-day mean by more than **50%**.
- Voice profile requires a minimum of **3** samples before any run is attempted.
- Revise loop cap: **2** rounds, then the post is stored as `needs_work`.
- Craft rules adapted from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT) and [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (CC BY-SA 4.0) must carry an attribution comment at the top of `craft.ts`.

## File Structure

```
src/lib/content/
  voice.ts                 measure / profileFromSamples / compare      [pure]
  voice.test.ts
  daily/
    types.ts               ContentPost, ContentRun, pillars, formats, checks
    craft.ts               pillar+format catalogues, AI-tell lists, constitution
    craft.test.ts
    anchors.ts             concrete-detail extraction                  [pure]
    anchors.test.ts
    harvest.ts             snapshot -> ranked MaterialItem ledger      [pure]
    harvest.test.ts
    rotation.ts            guardrail validation                        [pure]
    rotation.test.ts
    gate.ts                the anti-slop checks                        [pure]
    gate.test.ts
    store.ts               server-authored tables + schema bootstrap
    store.test.ts
    brief.ts               model call 1 (prompt builder + caller)
    brief.test.ts
    draft.ts               model call 2
    draft.test.ts
    revise.ts              model call 3
    revise.test.ts
    run.ts                 orchestrator
    run.test.ts
src/app/api/content/daily/route.ts
src/app/api/content/posts/route.ts
src/app/api/content/posts/[id]/route.ts
src/lib/dailyClient.ts     client fetch helpers
src/components/content/TodayPanel.tsx
src/components/content/PostCard.tsx
src/components/content/VoicePanel.tsx
```

Modified: `src/lib/types.ts`, `src/lib/store.tsx`, `src/lib/seed.ts`, `src/lib/db/sqlite.ts`, `src/app/content/page.tsx`, `src/middleware.ts`, `.env.example`, `vercel.json` (new).

---

# Phase 1 — Pure core

No model calls, no schema, no UI. This phase carries the entire quality argument and is provable in isolation.

---

### Task 1: Voice measurement primitives

**Files:**
- Create: `src/lib/content/voice.ts`
- Test: `src/lib/content/voice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `VoiceStats` interface; `splitSentences(text: string): string[]`; `splitParagraphs(text: string): string[]`; `measure(text: string): VoiceStats`.

`VoiceStats` fields, all numbers: `burstiness`, `avgSentenceLength`, `shortSentenceRatio`, `contractionRate`, `questionRate`, `avgParagraphSentences`, `emojiPerPost`, `firstPersonRate`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/voice.test.ts
import { describe, it, expect } from "vitest";
import { splitSentences, splitParagraphs, measure } from "./voice";

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("treats a newline as a sentence boundary (LinkedIn posts often drop full stops)", () => {
    expect(splitSentences("No full stop here\nSecond line")).toEqual([
      "No full stop here",
      "Second line",
    ]);
  });

  it("ignores empty fragments from trailing punctuation and blank lines", () => {
    expect(splitSentences("Done.\n\n\n")).toEqual(["Done."]);
  });
});

describe("splitParagraphs", () => {
  it("splits on any run of newlines, so broetry counts as many paragraphs", () => {
    expect(splitParagraphs("A.\n\nB.\nC.")).toEqual(["A.", "B.", "C."]);
  });
});

describe("measure", () => {
  it("returns zero burstiness when every sentence is the same length", () => {
    const text = "aa bb cc dd. aa bb cc dd. aa bb cc dd. aa bb cc dd.";
    expect(measure(text).burstiness).toBe(0);
  });

  it("computes burstiness as population stddev over mean", () => {
    // Sentence word counts: 2 and 18. mean 10, stddev 8 => 0.8
    const short = "aa bb.";
    const long = Array.from({ length: 18 }, (_, i) => `w${i}`).join(" ") + ".";
    expect(measure(`${short} ${long}`).burstiness).toBeCloseTo(0.8, 5);
  });

  it("counts short sentences as those under eight words", () => {
    // 3 words, 3 words, 9 words => 2/3 short
    const text = "one two three. four five six. a b c d e f g h i.";
    expect(measure(text).shortSentenceRatio).toBeCloseTo(2 / 3, 5);
  });

  it("counts contractions per hundred words, straight and curly apostrophes", () => {
    const words = Array.from({ length: 96 }, (_, i) => `w${i}`).join(" ");
    // 4 contractions in 100 words => 4
    const text = `don't can't it’s we’re ${words}.`;
    expect(measure(text).contractionRate).toBeCloseTo(4, 5);
  });

  it("counts questions per hundred sentences", () => {
    expect(measure("A. B? C. D?").questionRate).toBeCloseTo(50, 5);
  });

  it("counts emoji", () => {
    expect(measure("Shipping today \u{1F680}\u{1F525}").emojiPerPost).toBe(2);
  });

  it("counts first-person pronouns per hundred words", () => {
    const words = Array.from({ length: 98 }, (_, i) => `w${i}`).join(" ");
    expect(measure(`I my ${words}.`).firstPersonRate).toBeCloseTo(2, 5);
  });

  it("returns all-zero stats for empty input rather than NaN", () => {
    const s = measure("   ");
    expect(s.burstiness).toBe(0);
    expect(s.avgSentenceLength).toBe(0);
    expect(Number.isNaN(s.contractionRate)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/voice.test.ts`
Expected: FAIL — `Failed to resolve import "./voice"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/voice.ts
/* ============================================================
   Voice measurement — pure, no model calls.

   The same functions run over the founder's writing samples and
   over every generated draft, which is what makes "sounds like
   him" a measurable claim rather than a hope.
   ============================================================ */

export interface VoiceStats {
  /** stddev / mean of sentence word-counts. Low = machine-uniform. */
  burstiness: number;
  avgSentenceLength: number;
  /** Share (0-1) of sentences under 8 words. */
  shortSentenceRatio: number;
  /** Contractions per 100 words. */
  contractionRate: number;
  /** Questions per 100 sentences. */
  questionRate: number;
  avgParagraphSentences: number;
  emojiPerPost: number;
  /** I/my/me/we/our/us per 100 words. */
  firstPersonRate: number;
}

export const ZERO_STATS: VoiceStats = {
  burstiness: 0,
  avgSentenceLength: 0,
  shortSentenceRatio: 0,
  contractionRate: 0,
  questionRate: 0,
  avgParagraphSentences: 0,
  emojiPerPost: 0,
  firstPersonRate: 0,
};

/** A newline ends a sentence too — LinkedIn posts routinely drop full stops. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[A-Za-z0-9]/.test(s));
}

/** Any run of newlines starts a new paragraph, so broetry reads as many. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function measure(text: string): VoiceStats {
  const sentences = splitSentences(text);
  const allWords = words(text);
  if (sentences.length === 0 || allWords.length === 0) return { ...ZERO_STATS };

  const lengths = sentences.map((s) => words(s).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);

  const paragraphs = splitParagraphs(text);

  return {
    burstiness: mean === 0 ? 0 : stddev / mean,
    avgSentenceLength: mean,
    shortSentenceRatio: lengths.filter((n) => n < 8).length / lengths.length,
    contractionRate:
      (countMatches(text, /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi) /
        allWords.length) *
      100,
    questionRate:
      (sentences.filter((s) => s.endsWith("?")).length / sentences.length) * 100,
    avgParagraphSentences:
      paragraphs.length === 0 ? 0 : sentences.length / paragraphs.length,
    emojiPerPost: countMatches(text, /\p{Extended_Pictographic}/gu),
    firstPersonRate:
      (countMatches(text, /\b(?:I|my|me|we|our|us)\b/gi) / allWords.length) * 100,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/voice.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/voice.ts src/lib/content/voice.test.ts
git commit -m "feat(content): measurable voice statistics"
```

---

### Task 2: Voice profile aggregation and comparison

**Files:**
- Modify: `src/lib/content/voice.ts` (append)
- Test: `src/lib/content/voice.test.ts` (append)

**Interfaces:**
- Consumes: `VoiceStats`, `measure` from Task 1.
- Produces: `profileFromSamples(samples: string[]): VoiceStats`; `Deviation { metric: keyof VoiceStats; draft: number; profile: number; detail: string }`; `compare(draft: VoiceStats, profile: VoiceStats): Deviation[]`.

Median rather than mean, so one odd sample cannot skew the profile. `compare` flags burstiness only when the draft is **below** the profile — more variety than usual is not a fault.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/content/voice.test.ts
import { profileFromSamples, compare } from "./voice";

describe("profileFromSamples", () => {
  it("takes the median so one odd sample cannot skew the profile", () => {
    const uniform = "aa bb cc dd. aa bb cc dd. aa bb cc dd.";        // burstiness 0
    const varied = "aa. " + Array.from({ length: 18 }, (_, i) => `w${i}`).join(" ") + ".";
    const profile = profileFromSamples([uniform, uniform, varied]);
    expect(profile.burstiness).toBe(0); // median of [0, 0, ~0.8]
  });

  it("returns zero stats for no samples", () => {
    expect(profileFromSamples([]).burstiness).toBe(0);
  });
});

describe("compare", () => {
  const profile = { ...profileFromSamples(["aa. " + "w ".repeat(18) + "."]) };

  it("flags a draft that is markedly less varied than the founder", () => {
    const flat = measure("aa bb cc dd ee. aa bb cc dd ee. aa bb cc dd ee.");
    const devs = compare(flat, profile);
    expect(devs.some((d) => d.metric === "burstiness")).toBe(true);
    expect(devs.find((d) => d.metric === "burstiness")?.detail).toMatch(/uniform|varied/i);
  });

  it("does not flag a draft that is more varied than the founder", () => {
    const spiky = measure("a. " + "w ".repeat(40) + ". b.");
    expect(compare(spiky, profile).some((d) => d.metric === "burstiness")).toBe(false);
  });

  it("flags sentence length more than 40 percent off the founder's norm", () => {
    const longWinded = measure("w ".repeat(60) + ".");
    expect(compare(longWinded, profile).some((d) => d.metric === "avgSentenceLength")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/voice.test.ts`
Expected: FAIL — `profileFromSamples is not exported`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/lib/content/voice.ts

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const STAT_KEYS = Object.keys(ZERO_STATS) as (keyof VoiceStats)[];

/** Median across samples — one weird sample must not define the voice. */
export function profileFromSamples(samples: string[]): VoiceStats {
  const measured = samples.map(measure);
  if (measured.length === 0) return { ...ZERO_STATS };
  const out = { ...ZERO_STATS };
  for (const key of STAT_KEYS) {
    out[key] = median(measured.map((m) => m[key]));
  }
  return out;
}

export interface Deviation {
  metric: keyof VoiceStats;
  draft: number;
  profile: number;
  detail: string;
}

/** Relative tolerance per metric, as a fraction of the profile value. */
const TOLERANCE: Partial<Record<keyof VoiceStats, number>> = {
  avgSentenceLength: 0.4,
  shortSentenceRatio: 0.5,
  contractionRate: 0.6,
  avgParagraphSentences: 0.5,
};

/** Absolute floor below the profile's burstiness before we complain. */
const BURSTINESS_SLACK = 0.15;

export function compare(draft: VoiceStats, profile: VoiceStats): Deviation[] {
  const out: Deviation[] = [];

  // One-sided: more variety than usual is never a fault, less always is.
  if (draft.burstiness < profile.burstiness - BURSTINESS_SLACK) {
    out.push({
      metric: "burstiness",
      draft: draft.burstiness,
      profile: profile.burstiness,
      detail:
        `sentence rhythm is uniform (${draft.burstiness.toFixed(2)} against your ` +
        `${profile.burstiness.toFixed(2)}) — vary the lengths, land a short one`,
    });
  }

  for (const [metric, tolerance] of Object.entries(TOLERANCE) as [
    keyof VoiceStats,
    number,
  ][]) {
    const p = profile[metric];
    if (p === 0) continue;
    const drift = Math.abs(draft[metric] - p) / p;
    if (drift > tolerance) {
      out.push({
        metric,
        draft: draft[metric],
        profile: p,
        detail:
          `${metric} is ${draft[metric].toFixed(1)} against your ${p.toFixed(1)}`,
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/voice.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/voice.ts src/lib/content/voice.test.ts
git commit -m "feat(content): voice profile aggregation and drift comparison"
```

---

### Task 3: Daily types and the craft catalogue

**Files:**
- Create: `src/lib/content/daily/types.ts`
- Create: `src/lib/content/daily/craft.ts`
- Test: `src/lib/content/daily/craft.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: everything downstream depends on. From `types.ts`: `ContentPillar`, `PostFormat`, `KillReason`, `SourceRef`, `EditorialCheck`, `ContentPost`, `ContentRun`, `MaterialItem`, `PostBrief`. From `craft.ts`: `PILLARS`, `FORMATS`, `PILLAR_META`, `FORMAT_META`, `PILLAR_KEYWORDS`, `AI_TELL_PHRASES`, `AI_TELL_PATTERNS`, `ANTI_SLOP_CONSTITUTION`, `CRAFT_RULES`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/craft.test.ts
import { describe, it, expect } from "vitest";
import {
  PILLARS, FORMATS, PILLAR_META, FORMAT_META, PILLAR_KEYWORDS,
  AI_TELL_PHRASES, AI_TELL_PATTERNS, ANTI_SLOP_CONSTITUTION, CRAFT_RULES,
} from "./craft";

describe("catalogues", () => {
  it("has the six pillars and six formats from the spec", () => {
    expect([...PILLARS].sort()).toEqual([
      "build-log", "client-pain", "contrarian", "lesson", "proof", "teardown",
    ]);
    expect([...FORMATS].sort()).toEqual([
      "before-after", "claim-defence", "numbers", "one-idea", "scene", "short-punch",
    ]);
  });

  it("describes every pillar and every format", () => {
    for (const p of PILLARS) expect(PILLAR_META[p].description.length).toBeGreaterThan(20);
    for (const f of FORMATS) expect(FORMAT_META[f].shape.length).toBeGreaterThan(20);
  });

  it("maps source fields to pillar hints", () => {
    expect(PILLAR_KEYWORDS.some((k) => k.pillars.includes("client-pain"))).toBe(true);
    expect(PILLAR_KEYWORDS.every((k) => k.pillars.length > 0)).toBe(true);
  });
});

describe("AI tell catalogue", () => {
  it("carries the Wikipedia vocabulary", () => {
    for (const w of ["delve", "boasts", "tapestry", "testament", "underscore", "robust", "pivotal", "meticulous"]) {
      expect(AI_TELL_PHRASES).toContain(w);
    }
  });

  it("carries the LinkedIn-specific tells", () => {
    for (const w of ["here's the thing", "let that sink in", "read that again", "game-changer"]) {
      expect(AI_TELL_PHRASES).toContain(w);
    }
  });

  it("has named structural patterns with human-readable labels", () => {
    const labels = AI_TELL_PATTERNS.map((p) => p.label);
    expect(labels).toContain("negative parallelism");
    expect(labels).toContain("rule of three");
    expect(AI_TELL_PATTERNS.every((p) => p.regex instanceof RegExp)).toBe(true);
  });

  it("catches 'It's not X, it's Y' and 'Not only ... but also'", () => {
    const neg = AI_TELL_PATTERNS.find((p) => p.label === "negative parallelism")!;
    expect(neg.regex.test("It's not a tool, it's a mindset.")).toBe(true);
    neg.regex.lastIndex = 0;
    expect(neg.regex.test("Not only did it ship, but it also worked.")).toBe(true);
    neg.regex.lastIndex = 0;
    expect(neg.regex.test("I shipped the dashboard on Tuesday.")).toBe(false);
  });
});

describe("prompt fragments", () => {
  it("forbids the tells explicitly and names the specificity rule", () => {
    expect(ANTI_SLOP_CONSTITUTION).toMatch(/never/i);
    expect(ANTI_SLOP_CONSTITUTION).toMatch(/specific|concrete/i);
    expect(CRAFT_RULES.length).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/craft.test.ts`
Expected: FAIL — cannot resolve `./craft`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/content/daily/types.ts`:

```ts
export const PILLARS = [
  "client-pain", "build-log", "contrarian", "proof", "teardown", "lesson",
] as const;
export type ContentPillar = (typeof PILLARS)[number];

export const FORMATS = [
  "scene", "one-idea", "before-after", "claim-defence", "numbers", "short-punch",
] as const;
export type PostFormat = (typeof FORMATS)[number];

export const KILL_REASONS = [
  "boring", "not_my_voice", "not_true", "wrong_angle", "already_said",
] as const;
export type KillReason = (typeof KILL_REASONS)[number];

export interface SourceRef {
  collection: string;
  id: string;
  /** The concrete detail lifted from this record. */
  anchor: string;
}

export interface EditorialCheck {
  rule: string;
  passed: boolean;
  /** Human-readable, specific, actionable. Never "make it better". */
  detail: string;
}

export interface MaterialItem {
  collection: string;
  id: string;
  date: string;
  text: string;
  anchors: string[];
  pillarHints: ContentPillar[];
  score: number;
}

export interface PostBrief {
  slot: 1 | 2;
  sourceRefs: SourceRef[];
  pillar: ContentPillar;
  format: PostFormat;
  /** The single thing this post asserts. Committed before any prose exists. */
  claim: string;
  anchor: string;
  why: string;
}

export type PostStatus = "draft" | "needs_work" | "kept" | "killed" | "posted";

export interface ContentPost {
  id: string;
  date: string;
  slot: 1 | 2;
  pillar: ContentPillar;
  format: PostFormat;
  sourceRefs: SourceRef[];
  claim: string;
  body: string;
  openingLine: string;
  checks: EditorialCheck[];
  revisions: number;
  status: PostStatus;
  killReason: KillReason | null;
  editedBody: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRun {
  id: string;
  date: string;
  status: "ok" | "thin" | "failed";
  ledgerSize: number;
  reachback: boolean;
  usedNews: boolean;
  degraded: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
```

Create `src/lib/content/daily/craft.ts`:

```ts
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
    description: "What was shipped, what broke, what got fixed this week.",
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
    description: "Something that went wrong, and what it actually cost.",
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
    regex: /\b(?:it'?s not (?:just )?[^.?!\n]{2,40}?,?\s*it'?s\b|not only\b[^.?!\n]{2,60}?\bbut also\b|\bno [^,\n]{2,20}, no [^,\n]{2,20}, just\b)/i,
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
    regex: /^\s*[-*•]\s*\*\*[^*\n]+\*\*\s*:/m,
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
6. Vary sentence length deliberately. Uniform rhythm is the single strongest signal
   of machine prose. Land a short sentence where it hurts.
7. Do not open with a question. Do not close with "What do you think?" or any
   variant. Do not write a one-line paragraph unless the line earns the isolation.
8. Never invent a client name, a number, a quote or a piece of history. If the
   record does not support the detail, write around it or pick different material.
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
```

Note the test asserts `PILLARS` has six entries; drop the `"numbers"` entry from
the `metric` keyword row if TypeScript rejects it — `numbers` is a format, not a
pillar. Correct that row to `{ match: /metric/i, pillars: ["proof"] }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/craft.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/types.ts src/lib/content/daily/craft.ts src/lib/content/daily/craft.test.ts
git commit -m "feat(content): daily engine types and craft catalogue"
```

---

### Task 4: Anchor extraction

**Files:**
- Create: `src/lib/content/daily/anchors.ts`
- Test: `src/lib/content/daily/anchors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractAnchors(text: string): string[]`.

Deliberately narrow so the function stays testable: numerals including currency and percentages, dates, capitalised multi-word proper nouns, and already-quoted spans. Nothing inferred.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/anchors.test.ts
import { describe, it, expect } from "vitest";
import { extractAnchors } from "./anchors";

describe("extractAnchors", () => {
  it("pulls plain numbers, percentages and currency", () => {
    const a = extractAnchors("Cut it from 14 hours to 2, a 47% drop, saving R120,000.");
    expect(a).toContain("14");
    expect(a).toContain("47%");
    expect(a).toContain("R120,000");
  });

  it("pulls ISO and written dates", () => {
    const a = extractAnchors("On 2026-07-14 and again on 12 June we saw it.");
    expect(a).toContain("2026-07-14");
    expect(a).toContain("12 June");
  });

  it("pulls multi-word proper nouns", () => {
    expect(extractAnchors("Spoke to Kloofwind Fund Managers again.")).toContain(
      "Kloofwind Fund Managers",
    );
  });

  it("pulls quoted spans, straight and curly", () => {
    const a = extractAnchors('He said "we rebuild it every month" and “nobody owns it”.');
    expect(a).toContain("we rebuild it every month");
    expect(a).toContain("nobody owns it");
  });

  it("ignores a single capitalised word at the start of a sentence", () => {
    expect(extractAnchors("Reconciliation is slow.")).toEqual([]);
  });

  it("deduplicates and returns an empty array for anchor-free text", () => {
    expect(extractAnchors("it takes ages and everyone hates it")).toEqual([]);
    expect(extractAnchors("47% and 47%")).toEqual(["47%"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/anchors.test.ts`
Expected: FAIL — cannot resolve `./anchors`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/anchors.ts
/* Concrete-detail extraction. Deliberately narrow: a post must be anchored
   to something a reader could check, and this decides what counts. */

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const PATTERNS: RegExp[] = [
  // ISO dates first, so they are not shredded by the number rule.
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // "12 June", "12 Jun 2026", "June 2026"
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "g"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, "g"),
  // Currency amounts: R120,000  $1.2m  £40k
  /\b[R$€£]\s?\d[\d,]*(?:\.\d+)?[kmb]?\b/gi,
  // Percentages and bare numbers (two or more digits, or any digit with a unit)
  /\b\d[\d,]*(?:\.\d+)?%/g,
  /\b\d[\d,]*(?:\.\d+)?\b/g,
  // Multi-word proper nouns
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
];

const QUOTES = [/"([^"\n]{4,})"/g, /“([^”\n]{4,})”/g];

export function extractAnchors(text: string): string[] {
  const found: string[] = [];

  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) found.push(m[0].trim());
  }
  for (const re of QUOTES) {
    for (const m of text.matchAll(re)) found.push(m[1].trim());
  }

  // A longer anchor that contains a shorter one makes the shorter redundant:
  // "R120,000" already covers "120,000".
  const unique = [...new Set(found)];
  return unique.filter(
    (a) => !unique.some((b) => b !== a && b.length > a.length && b.includes(a)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/anchors.test.ts`
Expected: PASS, 6 tests. If the currency test fails because the bare-number rule
also matched `120,000`, confirm the containment filter removed it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/anchors.ts src/lib/content/daily/anchors.test.ts
git commit -m "feat(content): deterministic anchor extraction"
```

---

### Task 5: Rotation guardrails

**Files:**
- Create: `src/lib/content/daily/rotation.ts`
- Test: `src/lib/content/daily/rotation.test.ts`

**Interfaces:**
- Consumes: `ContentPost`, `PostBrief`, `ContentPillar`, `PostFormat` from `./types`.
- Produces: `PILLAR_WINDOW_DAYS = 4`, `FORMAT_WINDOW_DAYS = 3`, `SOURCE_WINDOW_DAYS = 21`, `OPENER_HISTORY = 30`; `RotationMemory` interface; `buildMemory(posts: ContentPost[], today: string): RotationMemory`; `validateBriefs(briefs: PostBrief[], memory: RotationMemory): string[]` returning violation strings (empty means valid).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/rotation.test.ts
import { describe, it, expect } from "vitest";
import { buildMemory, validateBriefs } from "./rotation";
import type { ContentPost, PostBrief } from "./types";

function post(over: Partial<ContentPost>): ContentPost {
  return {
    id: "p1", date: "2026-08-01", slot: 1,
    pillar: "client-pain", format: "scene",
    sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
    claim: "c", body: "b", openingLine: "Something happened on Tuesday.",
    checks: [], revisions: 0, status: "draft", killReason: null, editedBody: null,
    createdAt: "", updatedAt: "", ...over,
  };
}

function brief(over: Partial<PostBrief>): PostBrief {
  return {
    slot: 1, sourceRefs: [{ collection: "painPoints", id: "zz", anchor: "x" }],
    pillar: "proof", format: "numbers", claim: "c", anchor: "x", why: "w", ...over,
  };
}

describe("validateBriefs", () => {
  const today = "2026-08-04";

  it("accepts two briefs that differ in pillar and format with clean history", () => {
    const memory = buildMemory([], today);
    const out = validateBriefs(
      [brief({ slot: 1 }), brief({ slot: 2, pillar: "lesson", format: "scene" })],
      memory,
    );
    expect(out).toEqual([]);
  });

  it("rejects a pillar reused within four days", () => {
    const memory = buildMemory([post({ date: "2026-08-02", pillar: "proof" })], today);
    const out = validateBriefs([brief({ slot: 1, pillar: "proof" })], memory);
    expect(out.join(" ")).toMatch(/pillar/i);
    expect(out.join(" ")).toMatch(/proof/);
  });

  it("allows a pillar reused outside the four-day window", () => {
    const memory = buildMemory([post({ date: "2026-07-25", pillar: "proof" })], today);
    expect(validateBriefs([brief({ slot: 1, pillar: "proof" })], memory)).toEqual([]);
  });

  it("rejects a format reused within three days", () => {
    const memory = buildMemory([post({ date: "2026-08-03", format: "numbers" })], today);
    expect(validateBriefs([brief({ slot: 1 })], memory).join(" ")).toMatch(/format/i);
  });

  it("rejects a source record reused within twenty-one days", () => {
    const memory = buildMemory(
      [post({ date: "2026-07-30", sourceRefs: [{ collection: "painPoints", id: "pp9", anchor: "a" }] })],
      today,
    );
    const out = validateBriefs(
      [brief({ sourceRefs: [{ collection: "painPoints", id: "pp9", anchor: "a" }] })],
      memory,
    );
    expect(out.join(" ")).toMatch(/source|already used/i);
  });

  it("rejects two same-day briefs sharing a pillar or a format", () => {
    const memory = buildMemory([], today);
    const samePillar = validateBriefs(
      [brief({ slot: 1 }), brief({ slot: 2, format: "scene" })], memory,
    );
    expect(samePillar.join(" ")).toMatch(/same day/i);
  });

  it("exposes recent opening lines, most recent first, capped at thirty", () => {
    const posts = Array.from({ length: 40 }, (_, i) =>
      post({ id: `p${i}`, date: "2026-08-01", openingLine: `line ${i}` }));
    expect(buildMemory(posts, today).recentOpeners).toHaveLength(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/rotation.test.ts`
Expected: FAIL — cannot resolve `./rotation`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/rotation.ts
/* Rotation guardrails. Enforced here in code, never as a prompt instruction —
   the model is not trusted to remember what it wrote last Tuesday. */

import { daysBetween } from "@/lib/utils";
import type { ContentPost, PostBrief, ContentPillar, PostFormat } from "./types";

export const PILLAR_WINDOW_DAYS = 4;
export const FORMAT_WINDOW_DAYS = 3;
export const SOURCE_WINDOW_DAYS = 21;
export const OPENER_HISTORY = 30;

export interface RotationMemory {
  /** Pillars used within PILLAR_WINDOW_DAYS, mapped to the date used. */
  recentPillars: Map<ContentPillar, string>;
  recentFormats: Map<PostFormat, string>;
  /** "collection:id" keys used within SOURCE_WINDOW_DAYS. */
  recentSources: Map<string, string>;
  recentOpeners: string[];
}

const sourceKey = (collection: string, id: string) => `${collection}:${id}`;

export function buildMemory(posts: ContentPost[], today: string): RotationMemory {
  const byRecency = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

  const recentPillars = new Map<ContentPillar, string>();
  const recentFormats = new Map<PostFormat, string>();
  const recentSources = new Map<string, string>();

  for (const p of byRecency) {
    const age = daysBetween(p.date, today);
    if (age < PILLAR_WINDOW_DAYS && !recentPillars.has(p.pillar)) {
      recentPillars.set(p.pillar, p.date);
    }
    if (age < FORMAT_WINDOW_DAYS && !recentFormats.has(p.format)) {
      recentFormats.set(p.format, p.date);
    }
    if (age < SOURCE_WINDOW_DAYS) {
      for (const ref of p.sourceRefs) {
        const key = sourceKey(ref.collection, ref.id);
        if (!recentSources.has(key)) recentSources.set(key, p.date);
      }
    }
  }

  return {
    recentPillars,
    recentFormats,
    recentSources,
    recentOpeners: byRecency
      .map((p) => p.openingLine)
      .filter(Boolean)
      .slice(0, OPENER_HISTORY),
  };
}

/** Returns violation strings. Empty means the briefs are acceptable. */
export function validateBriefs(
  briefs: PostBrief[],
  memory: RotationMemory,
): string[] {
  const out: string[] = [];

  for (const b of briefs) {
    const pillarDate = memory.recentPillars.get(b.pillar);
    if (pillarDate) {
      out.push(
        `slot ${b.slot}: pillar "${b.pillar}" was used on ${pillarDate}, inside the ` +
          `${PILLAR_WINDOW_DAYS}-day window — pick a different pillar`,
      );
    }

    const formatDate = memory.recentFormats.get(b.format);
    if (formatDate) {
      out.push(
        `slot ${b.slot}: format "${b.format}" was used on ${formatDate}, inside the ` +
          `${FORMAT_WINDOW_DAYS}-day window — pick a different format`,
      );
    }

    for (const ref of b.sourceRefs) {
      const usedOn = memory.recentSources.get(sourceKey(ref.collection, ref.id));
      if (usedOn) {
        out.push(
          `slot ${b.slot}: source ${ref.collection}/${ref.id} was already used on ` +
            `${usedOn}, inside the ${SOURCE_WINDOW_DAYS}-day window`,
        );
      }
    }
  }

  if (briefs.length === 2) {
    if (briefs[0].pillar === briefs[1].pillar) {
      out.push(`same day: both slots chose pillar "${briefs[0].pillar}" — they must differ`);
    }
    if (briefs[0].format === briefs[1].format) {
      out.push(`same day: both slots chose format "${briefs[0].format}" — they must differ`);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/rotation.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/rotation.ts src/lib/content/daily/rotation.test.ts
git commit -m "feat(content): rotation guardrails enforced in code"
```

---

### Task 6: The anti-slop gate

**Files:**
- Create: `src/lib/content/daily/gate.ts`
- Test: `src/lib/content/daily/gate.test.ts`

**Interfaces:**
- Consumes: `measure`, `compare`, `splitParagraphs`, `splitSentences`, `VoiceStats` from `@/lib/content/voice`; `AI_TELL_PHRASES`, `AI_TELL_PATTERNS` from `./craft`; `EditorialCheck`, `SourceRef` from `./types`; `extractAnchors` from `./anchors`.
- Produces: `BROETRY_THRESHOLD = 0.6`; `normaliseOpener(line: string): string`; `runGate(input: GateInput): EditorialCheck[]` where
  `GateInput = { body: string; sourceRefs: SourceRef[]; sourceTexts: string[]; profile: VoiceStats; neverSay: string[]; recentOpeners: string[] }`.

Every check appears in the output whether it passed or failed, so the UI can show the full report.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/gate.test.ts
import { describe, it, expect } from "vitest";
import { runGate, normaliseOpener } from "./gate";
import { profileFromSamples } from "@/lib/content/voice";
import type { SourceRef } from "./types";

const profile = profileFromSamples([
  "Shipped it Tuesday.\nThe reconciliation job that took 14 hours now takes 20 minutes.\nNobody asked for a dashboard.",
]);

const refs: SourceRef[] = [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }];
const sourceTexts = ["Reconciliation takes 14 hours every month end."];

function gate(body: string, over: Partial<Parameters<typeof runGate>[0]> = {}) {
  return runGate({
    body, sourceRefs: refs, sourceTexts, profile,
    neverSay: [], recentOpeners: [], ...over,
  });
}

const check = (body: string, rule: string) =>
  gate(body).find((c) => c.rule === rule)!;

const GOOD =
  "Reconciliation took them 14 hours every month end.\n" +
  "Fourteen. For numbers that already existed in two systems.\n" +
  "We wired the two together and it now runs in 20 minutes, unattended.\n" +
  "The finance lead's first reaction was not relief. It was embarrassment that nobody had asked sooner.";

describe("ai-tells", () => {
  it("stays quiet on clean prose", () => {
    expect(check(GOOD, "ai-tells").passed).toBe(true);
  });

  it("catches banned vocabulary and names the word", () => {
    const c = check("Let me delve into the robust results.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/delve/);
  });

  it("catches negative parallelism", () => {
    const c = check("It's not a tool, it's a mindset. We shipped it in 20 minutes.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/negative parallelism/i);
  });

  it("catches emoji bullets", () => {
    expect(check("\u{1F680} Faster\n\u{1F525} Cheaper", "ai-tells").passed).toBe(false);
  });
});

describe("specificity", () => {
  it("passes when an anchor from the post appears in a source record", () => {
    expect(check(GOOD, "specificity").passed).toBe(true);
  });

  it("fails when nothing in the post is verifiable", () => {
    const c = check(
      "Manual processes slow teams down.\nAutomation helps.\nThink about your workflows.",
      "specificity",
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/verifiable|unfalsifiable/i);
  });

  it("fails when the post's number is not in any source record", () => {
    const c = gate("We cut it from 900 hours to 3 hours flat.").find(
      (x) => x.rule === "specificity",
    )!;
    expect(c.passed).toBe(false);
  });
});

describe("broetry", () => {
  it("fails when more than sixty percent of paragraphs are one sentence", () => {
    const body = "One.\nTwo.\nThree.\nFour.\nFive.";
    const c = check(body, "broetry");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/5 of 5|one line|single sentence/i);
  });

  it("passes a post with real paragraphs", () => {
    const body =
      "They ran it for 14 hours. Every month end, without fail.\n\n" +
      "We wired the systems together. It takes 20 minutes now, and nobody watches it.";
    expect(check(body, "broetry").passed).toBe(true);
  });
});

describe("opener-collision", () => {
  it("fails when the opening line matches a recent opener's shape", () => {
    const c = gate(GOOD, {
      recentOpeners: ["Reconciliation took them 9 hours every quarter."],
    }).find((x) => x.rule === "opener-collision")!;
    expect(c.passed).toBe(false);
  });

  it("passes against unrelated openers", () => {
    const c = gate(GOOD, { recentOpeners: ["Nobody asked for a dashboard."] }).find(
      (x) => x.rule === "opener-collision",
    )!;
    expect(c.passed).toBe(true);
  });
});

describe("never-say", () => {
  it("fails on a founder-banned phrase and quotes it back", () => {
    const c = gate(GOOD + " We should leverage this.", { neverSay: ["leverage"] }).find(
      (x) => x.rule === "never-say",
    )!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/leverage/);
  });
});

describe("burstiness", () => {
  it("fails a draft markedly flatter than the founder's baseline", () => {
    const flat = "aa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.";
    expect(check(flat, "burstiness").passed).toBe(false);
  });
});

describe("normaliseOpener", () => {
  it("reduces an opener to its comparable shape", () => {
    expect(normaliseOpener("Reconciliation took them 14 hours!")).toBe(
      normaliseOpener("reconciliation took them 9 hours"),
    );
  });
});

describe("runGate", () => {
  it("reports every rule, passing or failing", () => {
    const rules = gate(GOOD).map((c) => c.rule).sort();
    expect(rules).toEqual(
      ["ai-tells", "broetry", "burstiness", "never-say", "opener-collision", "specificity"],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/gate.test.ts`
Expected: FAIL — cannot resolve `./gate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/gate.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/gate.test.ts`
Expected: PASS, 15 tests. If `ai-tells` fires on `GOOD`, print the detail and
remove the offending entry from `AI_TELL_PHRASES` only if it is a genuine false
positive — otherwise fix the fixture.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/gate.ts src/lib/content/daily/gate.test.ts
git commit -m "feat(content): deterministic anti-slop gate"
```

---

### Task 7: Material harvest

**Files:**
- Create: `src/lib/content/daily/harvest.ts`
- Test: `src/lib/content/daily/harvest.test.ts`

**Interfaces:**
- Consumes: `extractAnchors` from `./anchors`; `PILLAR_KEYWORDS` from `./craft`; `MaterialItem`, `ContentPost` from `./types`; `daysBetween`, `todayISO` from `@/lib/utils`; `DataShape` from `@/lib/types`.
- Produces: `RECENT_WINDOW_DAYS = 7`; `METRIC_SWING = 0.5`; `LedgerMode = "fresh" | "reachback" | "news"`; `collectCandidates(data: DataShape): MaterialItem[]`; `scoreItem(item: MaterialItem, today: string): number`; `buildLedger(data: DataShape, posts: ContentPost[], today: string): { items: MaterialItem[]; mode: LedgerMode }`.

`collectCandidates` walks: `interactions` (rawNotes, whatTheySaid, painPoints, objections, buyingSignals), `painPoints` (painPoint, workaround, possibleSolution, notes), `leads` (painPoint, objection, buyingSignal, notes), `projects` (currentBlocker, nextAction, deliverables, notes), `milestones` (name where status is done), `scorecards` (wins, problems, lessons, avoidTomorrow), `notes` (body), `metricEntries` (only on a >50% swing from the trailing 7-day mean).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/harvest.test.ts
import { describe, it, expect } from "vitest";
import { collectCandidates, buildLedger } from "./harvest";
import type { DataShape } from "@/lib/types";
import type { ContentPost } from "./types";

function data(over: Partial<DataShape> = {}): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [], contentThreads: [], brainThreads: [], newsFeed: [],
    newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
    milestones: [], projectThreads: [],
    settings: {} as DataShape["settings"],
    ...over,
  } as DataShape;
}

const painPoint = {
  id: "pp1", createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
  painPoint: "Reconciliation takes 14 hours every month end.",
  industry: "Asset management", companyType: "Boutique", whoMentioned: "CFO",
  frequency: 3, workaround: "Two analysts and a spreadsheet.",
  possibleSolution: "", urgency: "high", willingnessToPay: "high", notes: "",
} as unknown as DataShape["painPoints"][number];

describe("collectCandidates", () => {
  it("pulls pain points with their anchors and pillar hints", () => {
    const items = collectCandidates(data({ painPoints: [painPoint] }));
    const item = items.find((i) => i.id === "pp1")!;
    expect(item.collection).toBe("painPoints");
    expect(item.anchors).toContain("14");
    expect(item.pillarHints).toContain("client-pain");
  });

  it("skips empty and whitespace-only fields", () => {
    const blank = { ...painPoint, id: "pp2", painPoint: "   ", workaround: "" };
    expect(collectCandidates(data({ painPoints: [blank] })).some((i) => i.id === "pp2")).toBe(false);
  });

  it("only takes a metric entry when it swings more than half off its trailing mean", () => {
    const base = (date: string, value: number) => ({
      id: `m-${date}`, createdAt: date, updatedAt: date,
      metric: "callsMade" as const, date, value,
    });
    const steady = [base("2026-07-29", 10), base("2026-07-30", 10), base("2026-08-03", 10)];
    expect(collectCandidates(data({ metricEntries: steady as never })).length).toBe(0);

    const spike = [...steady, base("2026-08-04", 40)];
    const items = collectCandidates(data({ metricEntries: spike as never }));
    expect(items.some((i) => i.collection === "metricEntries")).toBe(true);
  });
});

describe("buildLedger", () => {
  const today = "2026-08-04";

  it("returns fresh mode when recent material exists", () => {
    const { items, mode } = buildLedger(data({ painPoints: [painPoint] }), [], today);
    expect(mode).toBe("fresh");
    expect(items.length).toBeGreaterThan(0);
  });

  it("excludes material used by a post inside the twenty-one day window", () => {
    const used = [{
      id: "p1", date: "2026-07-30", slot: 1, pillar: "client-pain", format: "scene",
      sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
      claim: "", body: "", openingLine: "", checks: [], revisions: 0,
      status: "posted", killReason: null, editedBody: null, createdAt: "", updatedAt: "",
    }] as ContentPost[];
    const { items } = buildLedger(data({ painPoints: [painPoint] }), used, today);
    expect(items.some((i) => i.id === "pp1")).toBe(false);
  });

  it("falls back to reachback when nothing is recent but older material is unused", () => {
    const old = { ...painPoint, id: "pp-old", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z" };
    const { items, mode } = buildLedger(data({ painPoints: [old] }), [], today);
    expect(mode).toBe("reachback");
    expect(items.length).toBeGreaterThan(0);
  });

  it("falls back to news when there is no usable material at all", () => {
    expect(buildLedger(data(), [], today).mode).toBe("news");
  });

  it("ranks items carrying anchors above items without", () => {
    const vague = { ...painPoint, id: "pp-vague", painPoint: "Everything takes ages and it is annoying." };
    const { items } = buildLedger(data({ painPoints: [painPoint, vague] }), [], today);
    expect(items[0].id).toBe("pp1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/harvest.test.ts`
Expected: FAIL — cannot resolve `./harvest`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/harvest.ts
/* Material harvest — pure, no model calls.

   Turns the founder's logged activity into a ranked ledger of things that
   could carry a post. The quality ceiling of the whole engine sits here:
   nothing downstream can write a specific post from vague material. */

import { daysBetween } from "@/lib/utils";
import type { DataShape } from "@/lib/types";
import { extractAnchors } from "./anchors";
import { PILLAR_KEYWORDS } from "./craft";
import type { ContentPillar, ContentPost, MaterialItem } from "./types";
import { SOURCE_WINDOW_DAYS } from "./rotation";

export const RECENT_WINDOW_DAYS = 7;
export const METRIC_SWING = 0.5;

export type LedgerMode = "fresh" | "reachback" | "news";

/** Language that marks material with something at stake. */
const CHARGED = /\b(?:broke|broken|failed|wrong|angry|frustrat|wasted|lost|stuck|hate|painful|embarrass|refus|blocked|missed|late|manual|again)\w*/i;

interface FieldSpec {
  collection: keyof DataShape;
  /** Fields read for text, in priority order. */
  fields: string[];
  dateField?: string;
}

const SPECS: FieldSpec[] = [
  { collection: "interactions", fields: ["rawNotes", "whatTheySaid", "painPoints", "objections", "buyingSignals"], dateField: "date" },
  { collection: "painPoints", fields: ["painPoint", "workaround", "possibleSolution", "notes"] },
  { collection: "leads", fields: ["painPoint", "objection", "buyingSignal", "notes"] },
  { collection: "projects", fields: ["currentBlocker", "nextAction", "deliverables", "notes"] },
  { collection: "scorecards", fields: ["wins", "problems", "lessons", "avoidTomorrow"], dateField: "date" },
  { collection: "notes", fields: ["body"] },
];

function hintsFor(fields: string[]): ContentPillar[] {
  const out = new Set<ContentPillar>();
  for (const f of fields) {
    for (const rule of PILLAR_KEYWORDS) {
      if (rule.match.test(f)) rule.pillars.forEach((p) => out.add(p));
    }
  }
  return [...out];
}

function recordDate(rec: Record<string, unknown>, dateField?: string): string {
  const raw =
    (dateField && (rec[dateField] as string)) ||
    (rec.updatedAt as string) ||
    (rec.createdAt as string) ||
    "";
  return raw.slice(0, 10);
}

export function collectCandidates(data: DataShape): MaterialItem[] {
  const out: MaterialItem[] = [];

  for (const spec of SPECS) {
    const rows = (data[spec.collection] ?? []) as unknown as Record<string, unknown>[];
    for (const rec of rows) {
      const usedFields: string[] = [];
      const parts: string[] = [];
      for (const f of spec.fields) {
        const value = rec[f];
        if (typeof value === "string" && value.trim().length > 0) {
          parts.push(value.trim());
          usedFields.push(f);
        }
      }
      if (parts.length === 0) continue;

      const text = parts.join(" — ");
      out.push({
        collection: spec.collection as string,
        id: String(rec.id),
        date: recordDate(rec, spec.dateField),
        text,
        anchors: extractAnchors(text),
        pillarHints: hintsFor(usedFields),
        score: 0,
      });
    }
  }

  // Completed milestones read as build-log material.
  for (const m of (data.milestones ?? []) as unknown as Record<string, unknown>[]) {
    if (m.status !== "done" || typeof m.name !== "string" || !m.name.trim()) continue;
    const text = `Milestone completed: ${m.name}`;
    out.push({
      collection: "milestones",
      id: String(m.id),
      date: recordDate(m, "endDate"),
      text,
      anchors: extractAnchors(text),
      pillarHints: ["build-log", "proof"],
      score: 0,
    });
  }

  // Metric entries only when the value genuinely moved.
  const metrics = (data.metricEntries ?? []) as unknown as {
    id: string; metric: string; date: string; value: number;
  }[];
  const byMetric = new Map<string, typeof metrics>();
  for (const e of metrics) {
    byMetric.set(e.metric, [...(byMetric.get(e.metric) ?? []), e]);
  }
  for (const [metric, entries] of byMetric) {
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const trailing = sorted.slice(0, -1).filter((e) => daysBetween(e.date, latest.date) <= 7);
    if (trailing.length === 0) continue;
    const mean = trailing.reduce((a, e) => a + e.value, 0) / trailing.length;
    if (mean === 0) continue;
    if (Math.abs(latest.value - mean) / mean <= METRIC_SWING) continue;

    const text = `${metric} moved to ${latest.value} against a recent average of ${mean.toFixed(1)}`;
    out.push({
      collection: "metricEntries",
      id: latest.id,
      date: latest.date,
      text,
      anchors: extractAnchors(text),
      pillarHints: ["proof"],
      score: 0,
    });
  }

  return out;
}

export function scoreItem(item: MaterialItem, today: string): number {
  const age = Math.max(0, daysBetween(item.date, today));
  const recency = Math.max(0, 20 - age);              // 0-20
  const specificity = Math.min(item.anchors.length, 4) * 8;  // 0-32
  const charge = CHARGED.test(item.text) ? 12 : 0;
  const substance = Math.min(item.text.length / 40, 10);     // 0-10
  return recency + specificity + charge + substance;
}

export function buildLedger(
  data: DataShape,
  posts: ContentPost[],
  today: string,
): { items: MaterialItem[]; mode: LedgerMode } {
  const usedKeys = new Set<string>();
  for (const p of posts) {
    if (daysBetween(p.date, today) >= SOURCE_WINDOW_DAYS) continue;
    for (const ref of p.sourceRefs) usedKeys.add(`${ref.collection}:${ref.id}`);
  }

  const all = collectCandidates(data)
    .filter((i) => !usedKeys.has(`${i.collection}:${i.id}`))
    .map((i) => ({ ...i, score: scoreItem(i, today) }))
    .sort((a, b) => b.score - a.score);

  const fresh = all.filter((i) => i.date && daysBetween(i.date, today) <= RECENT_WINDOW_DAYS);
  if (fresh.length > 0) return { items: fresh, mode: "fresh" };
  if (all.length > 0) return { items: all, mode: "reachback" };
  return { items: [], mode: "news" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/harvest.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm test
git add src/lib/content/daily/harvest.ts src/lib/content/daily/harvest.test.ts
git commit -m "feat(content): material harvest with reachback and news fallback"
```

---

# Phase 2 — Storage

---

### Task 8: Server-authored tables

**Files:**
- Create: `src/lib/content/daily/store.ts`
- Test: `src/lib/content/daily/store.test.ts`

**Interfaces:**
- Consumes: `getClient` from `@/lib/db/client`; `ContentPost`, `ContentRun` from `./types`.
- Produces: `ensureContentSchema(): Promise<void>`; `listPosts(date: string): Promise<ContentPost[]>`; `savePosts(posts: ContentPost[]): Promise<void>`; `patchPost(id: string, changes: Partial<ContentPost>): Promise<ContentPost | null>`; `recentPosts(days: number, today: string): Promise<ContentPost[]>`; `saveRun(run: ContentRun): Promise<void>`; `latestRun(date: string): Promise<ContentRun | null>`.

**Why these tables sit outside `COLLECTIONS`:** `saveAll` in `src/lib/db/sqlite.ts:133` deletes and reinserts every collection from the client's payload. A browser tab holding a pre-dawn snapshot would wipe cron-written rows. Keeping these tables out of that array is the isolation.

The test writes to a temp file database by setting `TURSO_DATABASE_URL` before import.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/store.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentPost, ContentRun } from "./types";

let store: typeof import("./store");

function post(over: Partial<ContentPost> = {}): ContentPost {
  return {
    id: "p1", date: "2026-08-04", slot: 1, pillar: "client-pain", format: "scene",
    sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
    claim: "c", body: "body", openingLine: "Opening.", checks: [], revisions: 0,
    status: "draft", killReason: null, editedBody: null,
    createdAt: "2026-08-04T04:00:00Z", updatedAt: "2026-08-04T04:00:00Z", ...over,
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pallisade-content-"));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  store = await import("./store");
  await store.ensureContentSchema();
});

describe("posts", () => {
  it("round-trips a post through save and list", async () => {
    await store.savePosts([post()]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRefs[0].anchor).toBe("14 hours");
  });

  it("returns posts for the requested date only, ordered by slot", async () => {
    await store.savePosts([post({ id: "p3", slot: 2 }), post({ id: "p2", date: "2026-08-03" })]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows.map((r) => r.slot)).toEqual([1, 2]);
  });

  it("patches only the given fields and bumps updatedAt", async () => {
    const before = (await store.listPosts("2026-08-04"))[0];
    const patched = await store.patchPost(before.id, { status: "kept" });
    expect(patched?.status).toBe("kept");
    expect(patched?.body).toBe(before.body);
    expect(patched?.updatedAt).not.toBe(before.updatedAt);
  });

  it("returns null when patching an unknown id", async () => {
    expect(await store.patchPost("nope", { status: "kept" })).toBeNull();
  });

  it("upserts rather than duplicating on repeated save", async () => {
    await store.savePosts([post({ body: "rewritten" })]);
    const rows = await store.listPosts("2026-08-04");
    expect(rows.filter((r) => r.id === "p1")).toHaveLength(1);
    expect(rows.find((r) => r.id === "p1")?.body).toBe("rewritten");
  });

  it("returns posts inside the recency window", async () => {
    const recent = await store.recentPosts(21, "2026-08-04");
    expect(recent.some((r) => r.date === "2026-08-03")).toBe(true);
    const narrow = await store.recentPosts(1, "2026-08-04");
    expect(narrow.every((r) => r.date === "2026-08-04")).toBe(true);
  });
});

describe("runs", () => {
  it("round-trips a run and returns the latest for a date", async () => {
    const run: ContentRun = {
      id: "r1", date: "2026-08-04", status: "ok", ledgerSize: 12,
      reachback: false, usedNews: false, degraded: [], error: null,
      startedAt: "2026-08-04T04:00:00Z", finishedAt: "2026-08-04T04:00:30Z",
    };
    await store.saveRun(run);
    expect((await store.latestRun("2026-08-04"))?.ledgerSize).toBe(12);
    expect(await store.latestRun("2026-01-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/store.ts
/* ============================================================
   Server-authored persistence for the daily engine.

   These tables are deliberately NOT in the COLLECTIONS array in
   src/lib/db/sqlite.ts. saveAll() there deletes and reinserts every
   listed collection from a client-supplied snapshot, so a browser tab
   opened before the cron ran would wipe the cron's rows on its next
   save. The engine owns this data; the client only patches it.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import { nowISO } from "@/lib/utils";
import type { ContentPost, ContentRun } from "./types";

let schemaReady: Promise<void> | null = null;

export async function ensureContentSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const client = getClient();
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS contentPosts (
                id         TEXT PRIMARY KEY,
                date       TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS contentRuns (
                id         TEXT PRIMARY KEY,
                date       TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_contentPosts_date ON contentPosts(date)`, args: [] },
      { sql: `CREATE INDEX IF NOT EXISTS idx_contentRuns_date ON contentRuns(date)`, args: [] },
    ];
    await client.batch(stmts, "write");
  })();

  return schemaReady;
}

function parsePost(json: string): ContentPost {
  return JSON.parse(json) as ContentPost;
}

export async function listPosts(date: string): Promise<ContentPost[]> {
  await ensureContentSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM contentPosts WHERE date = ? ORDER BY json_extract(json, '$.slot')`,
    args: [date],
  });
  return res.rows.map((r) => parsePost(r.json as string));
}

export async function savePosts(posts: ContentPost[]): Promise<void> {
  if (posts.length === 0) return;
  await ensureContentSchema();
  await getClient().batch(
    posts.map((p) => ({
      sql: `INSERT INTO contentPosts (id, date, json, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET date = excluded.date, json = excluded.json,
                                          updated_at = excluded.updated_at`,
      args: [p.id, p.date, JSON.stringify(p), p.updatedAt],
    })),
    "write",
  );
}

export async function patchPost(
  id: string,
  changes: Partial<ContentPost>,
): Promise<ContentPost | null> {
  await ensureContentSchema();
  const client = getClient();
  const res = await client.execute({
    sql: `SELECT json FROM contentPosts WHERE id = ?`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row) return null;

  const merged: ContentPost = {
    ...parsePost(row.json as string),
    ...changes,
    id,
    updatedAt: nowISO(),
  };
  await client.execute({
    sql: `UPDATE contentPosts SET date = ?, json = ?, updated_at = ? WHERE id = ?`,
    args: [merged.date, JSON.stringify(merged), merged.updatedAt, id],
  });
  return merged;
}

export async function recentPosts(days: number, today: string): Promise<ContentPost[]> {
  await ensureContentSchema();
  const from = new Date(`${today}T00:00:00`);
  from.setDate(from.getDate() - (days - 1));
  const fromISO = from.toISOString().slice(0, 10);

  const res = await getClient().execute({
    sql: `SELECT json FROM contentPosts WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    args: [fromISO, today],
  });
  return res.rows.map((r) => parsePost(r.json as string));
}

export async function saveRun(run: ContentRun): Promise<void> {
  await ensureContentSchema();
  await getClient().execute({
    sql: `INSERT INTO contentRuns (id, date, json, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    args: [run.id, run.date, JSON.stringify(run), run.finishedAt ?? run.startedAt],
  });
}

export async function latestRun(date: string): Promise<ContentRun | null> {
  await ensureContentSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM contentRuns WHERE date = ? ORDER BY updated_at DESC LIMIT 1`,
    args: [date],
  });
  const row = res.rows[0];
  return row ? (JSON.parse(row.json as string) as ContentRun) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/store.ts src/lib/content/daily/store.test.ts
git commit -m "feat(content): server-authored tables isolated from the client snapshot"
```

---

### Task 9: Register the client-authored voice collections

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db/sqlite.ts:16-35` (the `COLLECTIONS` array)
- Modify: `src/lib/store.tsx:91` (initial state) and the hooks block near `:339`
- Modify: `src/lib/seed.ts:859` (empty-state shape)
- Modify: `src/lib/db/apiAdapter.ts:37-59` (the `clear()` empty shape)

**Interfaces:**
- Consumes: `VoiceStats` from `@/lib/content/voice`.
- Produces: `VoiceSample`, `VoiceProfile` types; `DataShape.voiceSamples`, `DataShape.voiceProfile`; hooks `useVoiceSamples()`, `useVoiceProfile()`.

`voiceProfile` is a single-record collection, following the `newsFeed` pattern at `src/lib/store.tsx:339`.

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, beside the existing `PositioningProfile` block:

```ts
import type { VoiceStats } from "@/lib/content/voice";

export const VOICE_SOURCES = ["linkedin", "email", "voice-note", "other"] as const;
export type VoiceSource = (typeof VOICE_SOURCES)[number];

/** One thing the founder actually wrote, used to fingerprint the voice. */
export interface VoiceSample extends BaseRecord {
  text: string;
  source: VoiceSource;
}

/** Singleton, like newsFeed. Rebuilt only when samples change. */
export interface VoiceProfile extends BaseRecord {
  stats: VoiceStats;
  fingerprint: string;
  neverSay: string[];
  sampleCount: number;
  computedAt: string;
}
```

Add to `DataShape`, beside `positioningProfiles`:

```ts
  voiceSamples: VoiceSample[];
  voiceProfile: VoiceProfile[];
```

- [ ] **Step 2: Register the collections**

In `src/lib/db/sqlite.ts`, add `"voiceSamples"` and `"voiceProfile"` to `COLLECTIONS` after `"positioningProfiles"`. In `src/lib/store.tsx`, `src/lib/seed.ts` and `src/lib/db/apiAdapter.ts`, add `voiceSamples: []` and `voiceProfile: []` to each empty-state object.

- [ ] **Step 3: Add the hooks**

In `src/lib/store.tsx`, beside `useNewsFeed`:

```ts
export const useVoiceSamples = () => useStore().voiceSamples as VoiceSample[];
export const useVoiceProfile = () =>
  (useStore().voiceProfile as VoiceProfile[])[0] ?? null;
```

- [ ] **Step 4: Verify nothing broke**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; the existing suite still passes. TypeScript will point
at every empty-state object still missing the two keys — fix each one it names.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/db/sqlite.ts src/lib/store.tsx src/lib/seed.ts src/lib/db/apiAdapter.ts
git commit -m "feat(content): register voiceSamples and voiceProfile collections"
```

---

# Phase 3 — Voice capture

Nothing downstream is meaningful until real samples exist.

---

### Task 10: Voice panel

**Files:**
- Create: `src/components/content/VoicePanel.tsx`
- Modify: `src/app/content/page.tsx:174-231` (the left sidebar column)

**Interfaces:**
- Consumes: `useStore`, `useVoiceSamples`, `useVoiceProfile` from `@/lib/store`; `measure`, `profileFromSamples` from `@/lib/content/voice`; `Panel` from `@/components/ui/Panel`.
- Produces: default-exported `<VoicePanel />`.

Behaviour: list samples with a delete button and a word count; a textarea plus a source `<select>` to add one; a stats readout showing burstiness, average sentence length and short-sentence share; a **Rebuild fingerprint** button that recomputes `stats` locally via `profileFromSamples` and upserts the singleton. The prose `fingerprint` and `neverSay` are populated later by Task 14 — until then the button writes `stats`, `sampleCount` and `computedAt`, leaving `fingerprint` as an empty string and `neverSay` as `[]`.

Show a clear "needs at least 3 samples" state below three samples, since the run refuses to start without them.

- [ ] **Step 1: Build the component**

```tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { useStore, useVoiceSamples, useVoiceProfile } from "@/lib/store";
import { Panel } from "@/components/ui/Panel";
import { profileFromSamples } from "@/lib/content/voice";
import { nowISO } from "@/lib/utils";
import type { VoiceProfile, VoiceSample, VoiceSource } from "@/lib/types";

const SOURCES: { value: VoiceSource; label: string }[] = [
  { value: "linkedin", label: "LinkedIn post" },
  { value: "email", label: "Email" },
  { value: "voice-note", label: "Voice note" },
  { value: "other", label: "Other" },
];

export const MIN_SAMPLES = 3;

export default function VoicePanel() {
  const store = useStore();
  const samples = useVoiceSamples();
  const profile = useVoiceProfile();
  const [text, setText] = useState("");
  const [source, setSource] = useState<VoiceSource>("linkedin");

  const add = () => {
    const body = text.trim();
    if (!body) return;
    store.create("voiceSamples", { text: body, source } as Omit<
      VoiceSample, "id" | "createdAt" | "updatedAt"
    >);
    setText("");
  };

  const rebuild = () => {
    const stats = profileFromSamples(samples.map((s) => s.text));
    const patch = {
      stats,
      sampleCount: samples.length,
      computedAt: nowISO(),
      fingerprint: profile?.fingerprint ?? "",
      neverSay: profile?.neverSay ?? [],
    };
    if (profile) store.update("voiceProfile", profile.id, patch);
    else store.create("voiceProfile", patch as Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">);
  };

  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  return (
    <Panel title="Voice">
      <div className="flex flex-col gap-1.5">
        {samples.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 text-[0.8rem]">
            <span className="truncate flex-1 text-[var(--color-muted)]">
              {s.text.slice(0, 40)}…
            </span>
            <span className="text-[0.7rem] text-[var(--color-dim)]">{wordCount(s.text)}w</span>
            <button
              className="btn btn-sm"
              title="Delete sample"
              onClick={() => store.remove("voiceSamples", s.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {samples.length < MIN_SAMPLES && (
          <p className="text-[0.75rem] text-[var(--color-dim)]">
            {MIN_SAMPLES - samples.length} more sample
            {MIN_SAMPLES - samples.length === 1 ? "" : "s"} needed before the daily
            engine will run. Paste anything you wrote — posts, emails, rough notes.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
        <textarea
          className="textarea"
          rows={4}
          placeholder="Paste something you wrote…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={source}
            onChange={(e) => setSource(e.target.value as VoiceSource)}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button className="btn btn-accent btn-sm" onClick={add} disabled={!text.trim()}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {profile && (
        <div className="mt-3 pt-3 border-t border-[var(--color-line)] text-[0.75rem] text-[var(--color-muted)] space-y-0.5">
          <div>Rhythm (burstiness): {profile.stats.burstiness.toFixed(2)}</div>
          <div>Avg sentence: {profile.stats.avgSentenceLength.toFixed(1)} words</div>
          <div>Short sentences: {(profile.stats.shortSentenceRatio * 100).toFixed(0)}%</div>
          <div className="text-[var(--color-dim)]">
            From {profile.sampleCount} sample{profile.sampleCount === 1 ? "" : "s"}
          </div>
        </div>
      )}

      <button
        className="btn btn-sm w-full justify-start mt-3"
        onClick={rebuild}
        disabled={samples.length === 0}
      >
        <RefreshCw size={13} /> Rebuild fingerprint
      </button>
    </Panel>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/app/content/page.tsx`, import it and render `<VoicePanel />` inside the
left column `<div className="flex flex-col gap-5">`, below the existing
"Positioning profiles" `<Panel>`.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, open `/content`. Paste three samples, click **Rebuild
fingerprint**, confirm the stats readout appears with a non-zero burstiness.
Reload the page and confirm the samples and stats survive.

- [ ] **Step 4: Commit**

```bash
git add src/components/content/VoicePanel.tsx src/app/content/page.tsx
git commit -m "feat(content): voice sample capture and measured fingerprint"
```

---

# Phase 4 — Pipeline

---

### Task 11: Brief stage

**Files:**
- Create: `src/lib/content/daily/brief.ts`
- Test: `src/lib/content/daily/brief.test.ts`

**Interfaces:**
- Consumes: `MaterialItem`, `PostBrief` from `./types`; `RotationMemory`, `validateBriefs` from `./rotation`; `PILLAR_META`, `FORMAT_META` from `./craft`; `Anthropic` SDK.
- Produces: `BRIEF_SCHEMA` (an `Anthropic.Tool`); `buildBriefPrompt(input: BriefPromptInput): string`; `chooseBriefs(client, input, memory): Promise<PostBrief[]>` where
  `BriefPromptInput = { ledger: MaterialItem[]; memory: RotationMemory; positioning: string; fingerprint: string; today: string }`.

The model is forced through a tool call so the output is structured. `chooseBriefs` validates against `validateBriefs` and retries **once** with the violations named, then throws `Error("brief_invalid: …")`.

Tests cover the prompt builder and the validation retry with a stubbed client — not the live API.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/brief.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildBriefPrompt, chooseBriefs, BRIEF_SCHEMA } from "./brief";
import { buildMemory } from "./rotation";
import type { MaterialItem, PostBrief } from "./types";

const ledger: MaterialItem[] = [
  { collection: "painPoints", id: "pp1", date: "2026-08-03",
    text: "Reconciliation takes 14 hours every month end.",
    anchors: ["14"], pillarHints: ["client-pain"], score: 50 },
  { collection: "scorecards", id: "sc1", date: "2026-08-02",
    text: "Shipped the ingest job. Broke twice.",
    anchors: [], pillarHints: ["build-log", "lesson"], score: 30 },
];

const base = {
  ledger, memory: buildMemory([], "2026-08-04"),
  positioning: "We sell calm to overwhelmed finance teams.",
  fingerprint: "Blunt, concrete, allergic to abstraction.",
  today: "2026-08-04",
};

describe("buildBriefPrompt", () => {
  it("lists every ledger item with its id, collection and anchors", () => {
    const p = buildBriefPrompt(base);
    expect(p).toContain("painPoints/pp1");
    expect(p).toContain("Reconciliation takes 14 hours");
    expect(p).toContain("14");
  });

  it("states the rotation constraints the model must respect", () => {
    const memory = buildMemory(
      [{ id: "x", date: "2026-08-03", slot: 1, pillar: "proof", format: "numbers",
         sourceRefs: [], claim: "", body: "", openingLine: "An opener.", checks: [],
         revisions: 0, status: "posted", killReason: null, editedBody: null,
         createdAt: "", updatedAt: "" }],
      "2026-08-04",
    );
    const p = buildBriefPrompt({ ...base, memory });
    expect(p).toMatch(/proof/);
    expect(p).toMatch(/numbers/);
    expect(p).toMatch(/must differ/i);
  });

  it("embeds the positioning and the voice fingerprint", () => {
    const p = buildBriefPrompt(base);
    expect(p).toContain("We sell calm to overwhelmed finance teams.");
    expect(p).toContain("allergic to abstraction");
  });

  it("demands a claim and an anchor per slot", () => {
    expect(buildBriefPrompt(base)).toMatch(/claim/i);
    expect(buildBriefPrompt(base)).toMatch(/anchor/i);
  });
});

describe("BRIEF_SCHEMA", () => {
  it("requires two briefs with the load-bearing fields", () => {
    const props = BRIEF_SCHEMA.input_schema.properties as Record<string, unknown>;
    expect(props.briefs).toBeDefined();
    const items = (props.briefs as { items: { required: string[] } }).items;
    expect(items.required).toEqual(
      expect.arrayContaining(["slot", "pillar", "format", "claim", "anchor", "sourceRefs"]),
    );
  });
});

function stubClient(responses: PostBrief[][]) {
  let call = 0;
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{
          type: "tool_use", id: `t${call}`, name: "submit_briefs",
          input: { briefs: responses[call++] },
        }],
        stop_reason: "tool_use",
      })),
    },
  } as never;
}

const valid: PostBrief[] = [
  { slot: 1, sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14" }],
    pillar: "client-pain", format: "scene", claim: "c", anchor: "14", why: "w" },
  { slot: 2, sourceRefs: [{ collection: "scorecards", id: "sc1", anchor: "twice" }],
    pillar: "build-log", format: "numbers", claim: "c", anchor: "twice", why: "w" },
];

describe("chooseBriefs", () => {
  it("returns validated briefs on the first pass", async () => {
    const client = stubClient([valid]);
    expect(await chooseBriefs(client, base, base.memory)).toHaveLength(2);
  });

  it("retries once, naming the violation, when the model breaks a guardrail", async () => {
    const clash = [valid[0], { ...valid[1], pillar: "client-pain" as const }];
    const client = stubClient([clash, valid]);
    const out = await chooseBriefs(client, base, base.memory);
    expect(out).toHaveLength(2);
    const second = (client as unknown as { messages: { create: { mock: { calls: unknown[][] } } } })
      .messages.create.mock.calls[1][0] as { messages: { content: string }[] };
    expect(JSON.stringify(second.messages)).toMatch(/same day|must differ/i);
  });

  it("throws when the retry also violates the guardrails", async () => {
    const clash = [valid[0], { ...valid[1], pillar: "client-pain" as const }];
    await expect(chooseBriefs(stubClient([clash, clash]), base, base.memory))
      .rejects.toThrow(/brief_invalid/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/brief.test.ts`
Expected: FAIL — cannot resolve `./brief`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/brief.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/brief.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/brief.ts src/lib/content/daily/brief.test.ts
git commit -m "feat(content): brief stage with code-enforced rotation retry"
```

---

### Task 12: Draft and revise stages

**Files:**
- Create: `src/lib/content/daily/draft.ts`
- Create: `src/lib/content/daily/revise.ts`
- Test: `src/lib/content/daily/draft.test.ts`

**Interfaces:**
- Consumes: `PostBrief`, `MaterialItem`, `EditorialCheck` from `./types`; `ANTI_SLOP_CONSTITUTION`, `CRAFT_RULES`, `PILLAR_META`, `FORMAT_META` from `./craft`; `VoiceStats` from `@/lib/content/voice`.
- Produces: `buildDraftPrompt(input: DraftInput): string`; `draftPost(client, input): Promise<string>`;
  `buildRevisePrompt(input: ReviseInput): string`; `revisePost(client, input): Promise<string>`.

```ts
interface DraftInput {
  brief: PostBrief;
  sourceTexts: string[];
  positioning: string;
  fingerprint: string;
  stats: VoiceStats;
  samples: string[];        // 2-3 nearest, chosen by caller
  killedExamples: { body: string; reason: string }[];
  editPairs: { before: string; after: string }[];
  neverSay: string[];
}

interface ReviseInput extends DraftInput {
  body: string;
  failures: EditorialCheck[];   // only the failed ones
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/draft.test.ts
import { describe, it, expect } from "vitest";
import { buildDraftPrompt } from "./draft";
import { buildRevisePrompt } from "./revise";
import { profileFromSamples } from "@/lib/content/voice";
import type { PostBrief, EditorialCheck } from "./types";

const brief: PostBrief = {
  slot: 1, sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
  pillar: "client-pain", format: "scene",
  claim: "Nobody owned the reconciliation, so it cost 14 hours a month.",
  anchor: "14 hours", why: "It is the sharpest thing logged this week.",
};

const base = {
  brief,
  sourceTexts: ["Reconciliation takes 14 hours every month end."],
  positioning: "We sell calm to overwhelmed finance teams.",
  fingerprint: "Blunt, concrete, allergic to abstraction.",
  stats: profileFromSamples(["Shipped it Tuesday. The job that took 14 hours now takes 20 minutes."]),
  samples: ["Shipped it Tuesday."],
  killedExamples: [{ body: "Manual work is bad.", reason: "boring" }],
  editPairs: [{ before: "We leveraged automation.", after: "We wired the two systems together." }],
  neverSay: ["leverage"],
};

describe("buildDraftPrompt", () => {
  it("carries the claim, the anchor and the source text", () => {
    const p = buildDraftPrompt(base);
    expect(p).toContain("Nobody owned the reconciliation");
    expect(p).toContain("14 hours");
    expect(p).toContain("Reconciliation takes 14 hours every month end.");
  });

  it("states the pillar and the format shape", () => {
    const p = buildDraftPrompt(base);
    expect(p).toMatch(/client-pain/);
    expect(p).toMatch(/specific moment/i);
  });

  it("includes the anti-slop constitution and the craft rules", () => {
    const p = buildDraftPrompt(base);
    expect(p).toMatch(/It's not X, it's Y/);
    expect(p).toMatch(/Specificity is the whole game/);
  });

  it("gives the founder's numeric targets so rhythm is a target, not a vibe", () => {
    const p = buildDraftPrompt(base);
    expect(p).toMatch(/burstiness|rhythm/i);
    expect(p).toMatch(/\d/);
  });

  it("passes killed posts, edit pairs and the never-say list as feedback", () => {
    const p = buildDraftPrompt(base);
    expect(p).toContain("Manual work is bad.");
    expect(p).toContain("We wired the two systems together.");
    expect(p).toContain("leverage");
  });

  it("forbids any output other than the post body", () => {
    expect(buildDraftPrompt(base)).toMatch(/only the post|nothing else|no preamble/i);
  });
});

describe("buildRevisePrompt", () => {
  const failures: EditorialCheck[] = [
    { rule: "ai-tells", passed: false, detail: 'negative parallelism — "It’s not X, it’s Y"' },
    { rule: "burstiness", passed: false, detail: "sentence rhythm is uniform (0.18 against your 0.55)" },
  ];

  it("quotes the draft and every named defect", () => {
    const p = buildRevisePrompt({ ...base, body: "It's not a tool, it's a mindset.", failures });
    expect(p).toContain("It's not a tool, it's a mindset.");
    expect(p).toContain("negative parallelism");
    expect(p).toContain("0.18");
  });

  it("tells the model to keep the claim and fix only the defects", () => {
    const p = buildRevisePrompt({ ...base, body: "x", failures });
    expect(p).toMatch(/same claim|keep the claim/i);
    expect(p).toMatch(/do not rewrite from scratch|only/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/draft.test.ts`
Expected: FAIL — cannot resolve `./draft`.

- [ ] **Step 3: Write the two modules**

```ts
// src/lib/content/daily/draft.ts
/* Stage 2 — write the post against a brief that has already committed to a
   claim and an anchor. The model's job here is prose, not editorial judgement. */

import type Anthropic from "@anthropic-ai/sdk";
import type { VoiceStats } from "@/lib/content/voice";
import { ANTI_SLOP_CONSTITUTION, CRAFT_RULES, PILLAR_META, FORMAT_META } from "./craft";
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

export function buildDraftPrompt(input: DraftInput): string {
  const { brief, sourceTexts, positioning, fingerprint, stats, samples } = input;

  const feedback: string[] = [];
  if (input.editPairs.length > 0) {
    feedback.push(
      `POSTS HE REWROTE — the strongest signal you have. Match the "after", not the "before":`,
      ...input.editPairs.slice(0, 3).map(
        (p) => `  before: ${p.before}\n  after:  ${p.after}`,
      ),
    );
  }
  if (input.killedExamples.length > 0) {
    feedback.push(
      `POSTS HE KILLED — do not write anything like these:`,
      ...input.killedExamples.slice(0, 3).map((k) => `  (${k.reason}) ${k.body.slice(0, 200)}`),
    );
  }
  if (input.neverSay.length > 0) {
    feedback.push(`NEVER USE THESE WORDS OR PHRASES: ${input.neverSay.join(", ")}`);
  }

  return [
    `Write one LinkedIn post for this founder.`,
    ``,
    `POSITIONING:\n"""\n${positioning}\n"""`,
    ``,
    `HIS VOICE:\n${fingerprint || "(blunt, concrete, allergic to abstraction)"}`,
    ``,
    `VOICE TARGETS — measured from what he actually writes:\n${buildVoiceTargets(stats)}`,
    ``,
    samples.length ? `HOW HE SOUNDS:\n${samples.map((s) => `"""\n${s}\n"""`).join("\n")}` : "",
    ``,
    `THE BRIEF — already decided. Do not second-guess it:`,
    `- Pillar: ${brief.pillar} — ${PILLAR_META[brief.pillar].description}`,
    `- Format: ${brief.format} — ${FORMAT_META[brief.format].shape}`,
    `- The claim this post makes: ${brief.claim}`,
    `- The concrete anchor it is built on: ${brief.anchor}`,
    ``,
    `THE SOURCE RECORDS — the only facts you may use. Inventing anything is a failure:`,
    sourceTexts.map((t) => `"""\n${t}\n"""`).join("\n"),
    ``,
    ANTI_SLOP_CONSTITUTION,
    ``,
    CRAFT_RULES,
    ``,
    feedback.join("\n"),
    ``,
    `Return only the post body. No preamble, no title, no explanation, no hashtags.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

export async function draftPost(client: Anthropic, input: DraftInput): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildDraftPrompt(input) }],
  });
  return (response.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
```

```ts
// src/lib/content/daily/revise.ts
/* Stage 4 — fix named defects. The model never receives "make it better";
   it receives the specific rule that failed and why. */

import type Anthropic from "@anthropic-ai/sdk";
import { buildDraftPrompt, type DraftInput } from "./draft";
import type { EditorialCheck } from "./types";

const MODEL = "claude-sonnet-4-6";

export interface ReviseInput extends DraftInput {
  body: string;
  failures: EditorialCheck[];
}

export function buildRevisePrompt(input: ReviseInput): string {
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
  return (response.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/draft.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/daily/draft.ts src/lib/content/daily/revise.ts src/lib/content/daily/draft.test.ts
git commit -m "feat(content): draft and revise stages driven by named defects"
```

---

### Task 13: Orchestrator

**Files:**
- Create: `src/lib/content/daily/run.ts`
- Test: `src/lib/content/daily/run.test.ts`

**Interfaces:**
- Consumes: everything from Phases 1-2 plus `brief.ts`, `draft.ts`, `revise.ts`.
- Produces: `MAX_REVISIONS = 2`; `runDaily(deps: RunDeps): Promise<{ run: ContentRun; posts: ContentPost[] }>` where

```ts
interface RunDeps {
  data: DataShape;                      // full snapshot, loaded by the caller
  today: string;
  client: Anthropic;
  chooseBriefs: typeof import("./brief").chooseBriefs;
  draftPost: typeof import("./draft").draftPost;
  revisePost: typeof import("./revise").revisePost;
  loadRecentPosts: (days: number, today: string) => Promise<ContentPost[]>;
  persist: (posts: ContentPost[], run: ContentRun) => Promise<void>;
}
```

Dependency-injected so the test drives it with stubs and no network.

Flow: build ledger → build memory → choose briefs → for each brief, gather source texts, draft, gate, revise up to twice → persist posts and run. On thrown error, persist a `failed` run and rethrow.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/run.test.ts
import { describe, it, expect, vi } from "vitest";
import { runDaily } from "./run";
import type { DataShape } from "@/lib/types";
import type { ContentPost, PostBrief } from "./types";

const painPoint = {
  id: "pp1", createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
  painPoint: "Reconciliation takes 14 hours every month end.",
  industry: "Asset management", companyType: "Boutique", whoMentioned: "CFO",
  frequency: 3, workaround: "Two analysts and a spreadsheet.", possibleSolution: "",
  urgency: "high", willingnessToPay: "high", notes: "",
};

const scorecard = {
  id: "sc1", createdAt: "2026-08-02T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
  date: "2026-08-02", wins: "Shipped the ingest job in 3 days.",
  problems: "It broke twice on bad CSV rows.", lessons: "", avoidTomorrow: "",
};

function data(): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [],
    scorecards: [scorecard], painPoints: [painPoint], conversations: [],
    playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [{ id: "pf1", name: "P", body: "We sell calm.", createdAt: "", updatedAt: "" }],
    contentThreads: [], brainThreads: [], newsFeed: [], newsInterests: [],
    newsBookmarks: [], notes: [], metricEntries: [], milestones: [], projectThreads: [],
    voiceSamples: [
      { id: "v1", text: "Shipped it Tuesday. The job that took 14 hours now takes 20 minutes and nobody watches it.", source: "linkedin", createdAt: "", updatedAt: "" },
      { id: "v2", text: "Nobody asked for a dashboard. They asked to stop doing the same thing every month.", source: "linkedin", createdAt: "", updatedAt: "" },
      { id: "v3", text: "Two systems already held the numbers. We wired them together in an afternoon.", source: "linkedin", createdAt: "", updatedAt: "" },
    ],
    voiceProfile: [],
    settings: {} as DataShape["settings"],
  } as unknown as DataShape;
}

const briefs: PostBrief[] = [
  { slot: 1, sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14" }],
    pillar: "client-pain", format: "scene", claim: "c1", anchor: "14", why: "w" },
  { slot: 2, sourceRefs: [{ collection: "scorecards", id: "sc1", anchor: "3" }],
    pillar: "build-log", format: "numbers", claim: "c2", anchor: "3", why: "w" },
];

const CLEAN =
  "Reconciliation took them 14 hours every month end.\n\n" +
  "Fourteen. For numbers two systems already held.\n\n" +
  "We wired them together in an afternoon and it runs unattended now. The finance lead was not relieved. He was embarrassed nobody had asked sooner.";

function deps(over: Partial<Parameters<typeof runDaily>[0]> = {}) {
  return {
    data: data(),
    today: "2026-08-04",
    client: {} as never,
    chooseBriefs: vi.fn(async () => briefs),
    draftPost: vi.fn(async () => CLEAN),
    revisePost: vi.fn(async () => CLEAN),
    loadRecentPosts: vi.fn(async () => [] as ContentPost[]),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe("runDaily", () => {
  it("produces two posts and an ok run", async () => {
    const d = deps();
    const { run, posts } = await runDaily(d);
    expect(posts).toHaveLength(2);
    expect(run.status).toBe("ok");
    expect(run.ledgerSize).toBeGreaterThan(0);
    expect(d.persist).toHaveBeenCalledOnce();
  });

  it("stamps each post with its brief's pillar, format, claim and sources", async () => {
    const { posts } = await runDaily(deps());
    expect(posts[0].pillar).toBe("client-pain");
    expect(posts[1].format).toBe("numbers");
    expect(posts[0].sourceRefs[0].id).toBe("pp1");
    expect(posts[0].openingLine.length).toBeGreaterThan(0);
  });

  it("revises a failing draft and records the revision count", async () => {
    const bad = "It's not a tool, it's a mindset.\nDelve into it.\nLet that sink in.";
    const draftPost = vi.fn(async () => bad);
    const revisePost = vi.fn(async () => CLEAN);
    const { posts } = await runDaily(deps({ draftPost, revisePost }));
    expect(revisePost).toHaveBeenCalled();
    expect(posts[0].revisions).toBeGreaterThan(0);
    expect(posts[0].status).toBe("draft");
  });

  it("gives up after two revisions and marks the post needs_work", async () => {
    const bad = "It's not a tool, it's a mindset.\nDelve into it.\nLet that sink in.";
    const revisePost = vi.fn(async () => bad);
    const { posts } = await runDaily(deps({ draftPost: async () => bad, revisePost }));
    expect(posts[0].status).toBe("needs_work");
    expect(posts[0].revisions).toBe(2);
    expect(posts[0].checks.some((c) => !c.passed)).toBe(true);
  });

  it("marks the run thin when the ledger had to reach back", async () => {
    const old = data();
    (old.painPoints as unknown as { updatedAt: string }[])[0].updatedAt = "2026-05-01T00:00:00Z";
    (old.painPoints as unknown as { createdAt: string }[])[0].createdAt = "2026-05-01T00:00:00Z";
    (old.scorecards as unknown as { date: string }[])[0].date = "2026-05-02";
    const { run } = await runDaily(deps({ data: old }));
    expect(run.reachback).toBe(true);
    expect(run.status).toBe("thin");
  });

  it("refuses to run with fewer than three voice samples", async () => {
    const thin = data();
    thin.voiceSamples = thin.voiceSamples.slice(0, 2);
    await expect(runDaily(deps({ data: thin }))).rejects.toThrow(/voice_samples/);
  });

  it("refuses to run with no positioning profile", async () => {
    const none = data();
    none.positioningProfiles = [];
    await expect(runDaily(deps({ data: none }))).rejects.toThrow(/positioning/);
  });

  it("persists a failed run and rethrows when a stage throws", async () => {
    const persist = vi.fn(async () => {});
    const chooseBriefs = vi.fn(async () => { throw new Error("brief_invalid: nope"); });
    await expect(runDaily(deps({ chooseBriefs, persist }))).rejects.toThrow(/brief_invalid/);
    const run = persist.mock.calls[0][1] as { status: string; error: string | null };
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/brief_invalid/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/run.test.ts`
Expected: FAIL — cannot resolve `./run`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/content/daily/run.ts
/* The orchestrator. Dependency-injected so it is testable without a network. */

import type Anthropic from "@anthropic-ai/sdk";
import type { DataShape } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";
import { profileFromSamples, splitSentences } from "@/lib/content/voice";
import { buildLedger } from "./harvest";
import { buildMemory, SOURCE_WINDOW_DAYS } from "./rotation";
import { runGate } from "./gate";
import type { chooseBriefs as ChooseBriefs } from "./brief";
import type { draftPost as DraftPost, DraftInput } from "./draft";
import type { revisePost as RevisePost } from "./revise";
import type { ContentPost, ContentRun, EditorialCheck, MaterialItem, PostBrief } from "./types";

export const MAX_REVISIONS = 2;
export const MIN_VOICE_SAMPLES = 3;

export interface RunDeps {
  data: DataShape;
  today: string;
  client: Anthropic;
  chooseBriefs: typeof ChooseBriefs;
  draftPost: typeof DraftPost;
  revisePost: typeof RevisePost;
  loadRecentPosts: (days: number, today: string) => Promise<ContentPost[]>;
  persist: (posts: ContentPost[], run: ContentRun) => Promise<void>;
}

function sourceTextsFor(brief: PostBrief, ledger: MaterialItem[]): string[] {
  return brief.sourceRefs
    .map((ref) => ledger.find((i) => i.collection === ref.collection && i.id === ref.id)?.text)
    .filter((t): t is string => Boolean(t));
}

/** Killed bodies and edit pairs, harvested from history for the draft prompt. */
function feedbackFrom(posts: ContentPost[], pillar: string) {
  const killedExamples = posts
    .filter((p) => p.status === "killed" && p.pillar === pillar && p.body)
    .slice(0, 3)
    .map((p) => ({ body: p.body, reason: p.killReason ?? "killed" }));

  const editPairs = posts
    .filter((p) => p.editedBody && p.editedBody !== p.body)
    .slice(0, 3)
    .map((p) => ({ before: p.body, after: p.editedBody as string }));

  return { killedExamples, editPairs };
}

export async function runDaily(
  deps: RunDeps,
): Promise<{ run: ContentRun; posts: ContentPost[] }> {
  const { data, today, client } = deps;

  const run: ContentRun = {
    id: uid("run"),
    date: today,
    status: "ok",
    ledgerSize: 0,
    reachback: false,
    usedNews: false,
    degraded: [],
    error: null,
    startedAt: nowISO(),
    finishedAt: null,
  };

  try {
    const samples = (data.voiceSamples ?? []).map((s) => s.text).filter(Boolean);
    if (samples.length < MIN_VOICE_SAMPLES) {
      throw new Error(
        `voice_samples: need ${MIN_VOICE_SAMPLES} writing samples, have ${samples.length}`,
      );
    }

    const positioning = data.positioningProfiles?.[0]?.body;
    if (!positioning) throw new Error("positioning: no positioning profile saved");

    const stored = data.voiceProfile?.[0] ?? null;
    const stats = stored?.stats ?? profileFromSamples(samples);
    const fingerprint = stored?.fingerprint ?? "";
    const neverSay = (stored?.neverSay ?? []).slice(0, 60);

    const history = await deps.loadRecentPosts(SOURCE_WINDOW_DAYS, today);
    const { items: ledger, mode } = buildLedger(data, history, today);

    run.ledgerSize = ledger.length;
    run.reachback = mode === "reachback";
    run.usedNews = mode === "news";
    if (mode !== "fresh") {
      run.status = "thin";
      run.degraded.push(
        mode === "reachback"
          ? "no fresh material — reached back to older logged records"
          : "no logged material at all — built from the news feed",
      );
    }

    const memory = buildMemory(history, today);
    const briefs = await deps.chooseBriefs(
      client,
      { ledger, memory, positioning, fingerprint, today },
      memory,
    );

    const posts: ContentPost[] = [];

    for (const brief of briefs) {
      const sourceTexts = sourceTextsFor(brief, ledger);
      const { killedExamples, editPairs } = feedbackFrom(history, brief.pillar);

      const draftInput: DraftInput = {
        brief, sourceTexts, positioning, fingerprint, stats,
        samples: samples.slice(0, 3), killedExamples, editPairs, neverSay,
      };

      let body = await deps.draftPost(client, draftInput);
      let checks: EditorialCheck[] = [];
      let revisions = 0;

      for (;;) {
        checks = runGate({
          body, sourceRefs: brief.sourceRefs, sourceTexts,
          profile: stats, neverSay, recentOpeners: memory.recentOpeners,
        });
        const failures = checks.filter((c) => !c.passed);
        if (failures.length === 0 || revisions >= MAX_REVISIONS) break;

        revisions += 1;
        body = await deps.revisePost(client, { ...draftInput, body, failures });
      }

      const stillFailing = checks.some((c) => !c.passed);
      posts.push({
        id: uid("post"),
        date: today,
        slot: brief.slot,
        pillar: brief.pillar,
        format: brief.format,
        sourceRefs: brief.sourceRefs,
        claim: brief.claim,
        body,
        openingLine: splitSentences(body)[0] ?? "",
        checks,
        revisions,
        status: stillFailing ? "needs_work" : "draft",
        killReason: null,
        editedBody: null,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }

    run.finishedAt = nowISO();
    await deps.persist(posts, run);
    return { run, posts };
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    run.finishedAt = nowISO();
    await deps.persist([], run);
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/daily/run.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npx tsc --noEmit
git add src/lib/content/daily/run.ts src/lib/content/daily/run.test.ts
git commit -m "feat(content): daily engine orchestrator with revise loop and fallbacks"
```

---

### Task 14: Fingerprint generation

**Files:**
- Create: `src/lib/content/daily/fingerprint.ts`
- Create: `src/app/api/content/fingerprint/route.ts`
- Test: `src/lib/content/daily/fingerprint.test.ts`
- Modify: `src/components/content/VoicePanel.tsx` (make **Rebuild fingerprint** call the route)

**Interfaces:**
- Consumes: `Anthropic`; `profileFromSamples` from `@/lib/content/voice`.
- Produces: `buildFingerprintPrompt(samples: string[]): string`; `FINGERPRINT_SCHEMA: Anthropic.Tool`; `generateFingerprint(client, samples): Promise<{ fingerprint: string; neverSay: string[] }>`.

One model call, only when samples change. Not a daily cost.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/content/daily/fingerprint.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildFingerprintPrompt, generateFingerprint, FINGERPRINT_SCHEMA } from "./fingerprint";

const samples = ["Shipped it Tuesday.", "Nobody asked for a dashboard."];

describe("buildFingerprintPrompt", () => {
  it("includes every sample", () => {
    const p = buildFingerprintPrompt(samples);
    expect(p).toContain("Shipped it Tuesday.");
    expect(p).toContain("Nobody asked for a dashboard.");
  });

  it("asks for a voice description and things he would never say", () => {
    const p = buildFingerprintPrompt(samples);
    expect(p).toMatch(/never (?:say|write|use)/i);
    expect(p).toMatch(/rhythm|cadence|diction/i);
  });
});

describe("FINGERPRINT_SCHEMA", () => {
  it("requires both fields", () => {
    expect(FINGERPRINT_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(["fingerprint", "neverSay"]),
    );
  });
});

describe("generateFingerprint", () => {
  it("returns the tool payload", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [{
            type: "tool_use", id: "t1", name: "submit_fingerprint",
            input: { fingerprint: "Blunt and concrete.", neverSay: ["leverage", "synergy"] },
          }],
        })),
      },
    } as never;
    const out = await generateFingerprint(client, samples);
    expect(out.fingerprint).toBe("Blunt and concrete.");
    expect(out.neverSay).toContain("synergy");
  });

  it("throws when the model does not call the tool", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "hi" }] })) } } as never;
    await expect(generateFingerprint(client, samples)).rejects.toThrow(/fingerprint_failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/daily/fingerprint.test.ts`
Expected: FAIL — cannot resolve `./fingerprint`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/content/daily/fingerprint.ts
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

  const block = (response.content ?? []).find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_fingerprint",
  );
  if (!block) throw new Error("fingerprint_failed: model did not call submit_fingerprint");

  const input = block.input as { fingerprint?: string; neverSay?: string[] };
  return {
    fingerprint: input.fingerprint ?? "",
    neverSay: (input.neverSay ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
  };
}
```

- [ ] **Step 4: Add the route**

```ts
// src/app/api/content/fingerprint/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { generateFingerprint } from "@/lib/content/daily/fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let samples: string[];
  try {
    samples = ((await req.json()) as { samples?: string[] }).samples ?? [];
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (samples.length === 0) {
    return NextResponse.json({ error: "no_samples" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    return NextResponse.json(await generateFingerprint(client, samples));
  } catch (err) {
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
```

- [ ] **Step 5: Wire the button**

Replace `rebuild` in `VoicePanel.tsx` with this. The numeric half is computed
locally and saved even when the API call fails — measurement must never depend
on the network:

```tsx
const [rebuilding, setRebuilding] = useState(false);

const rebuild = async () => {
  setRebuilding(true);
  const texts = samples.map((s) => s.text);
  const stats = profileFromSamples(texts);

  let fingerprint = profile?.fingerprint ?? "";
  let neverSay = profile?.neverSay ?? [];
  try {
    const res = await fetch("/api/content/fingerprint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples: texts }),
    });
    if (res.ok) {
      const data = (await res.json()) as { fingerprint: string; neverSay: string[] };
      fingerprint = data.fingerprint;
      // Keep anything the founder added by hand via a kill.
      neverSay = [...new Set([...neverSay, ...data.neverSay])].slice(-60);
    }
  } catch {
    /* the measured stats below still save */
  }

  const patch = { stats, sampleCount: samples.length, computedAt: nowISO(), fingerprint, neverSay };
  if (profile) store.update("voiceProfile", profile.id, patch);
  else store.create("voiceProfile", patch as Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">);
  setRebuilding(false);
};
```

Change the button to `onClick={() => void rebuild()}` and show
`{rebuilding ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}`.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/lib/content/daily/fingerprint.test.ts && npm test
git add src/lib/content/daily/fingerprint.ts src/app/api/content/fingerprint/route.ts src/components/content/VoicePanel.tsx src/lib/content/daily/fingerprint.test.ts
git commit -m "feat(content): voice fingerprint generation"
```

---

# Phase 5 — Surface

---

### Task 15: Posts endpoints and client

**Files:**
- Create: `src/app/api/content/posts/route.ts`
- Create: `src/app/api/content/posts/[id]/route.ts`
- Create: `src/lib/dailyClient.ts`

**Interfaces:**
- Consumes: `listPosts`, `patchPost`, `latestRun` from `@/lib/content/daily/store`.
- Produces: `GET /api/content/posts?date=` → `{ posts: ContentPost[]; run: ContentRun | null }`; `PATCH /api/content/posts/:id` → `{ post: ContentPost }`; client helpers `fetchToday(date)`, `patchPost(id, changes)`, `runDailyNow(force?)`.

`PATCH` accepts only `status`, `killReason` and `editedBody`. Anything else is
ignored — the client must not be able to rewrite a post's provenance.

- [ ] **Step 1: Write the collection route**

```ts
// src/app/api/content/posts/route.ts
import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { listPosts, latestRun } from "@/lib/content/daily/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  try {
    const [posts, run] = await Promise.all([listPosts(date), latestRun(date)]);
    return NextResponse.json({ posts, run });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
```

- [ ] **Step 2: Write the item route**

```ts
// src/app/api/content/posts/[id]/route.ts
import { NextResponse } from "next/server";
import { apiError, DB_FAILED } from "@/lib/api/errors";
import { patchPost } from "@/lib/content/daily/store";
import { KILL_REASONS, type ContentPost, type KillReason, type PostStatus } from "@/lib/content/daily/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES: PostStatus[] = ["draft", "needs_work", "kept", "killed", "posted"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: string; killReason?: string | null; editedBody?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Only these three fields are client-writable. Provenance stays server-owned.
  const changes: Partial<ContentPost> = {};
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status as PostStatus)) {
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }
    changes.status = body.status as PostStatus;
  }
  if (body.killReason !== undefined) {
    if (body.killReason !== null && !(KILL_REASONS as readonly string[]).includes(body.killReason)) {
      return NextResponse.json({ error: "bad_kill_reason" }, { status: 400 });
    }
    changes.killReason = body.killReason as KillReason | null;
  }
  if (body.editedBody !== undefined) changes.editedBody = body.editedBody;

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  try {
    const post = await patchPost(id, changes);
    if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ post });
  } catch (err) {
    return apiError(DB_FAILED, 500, err);
  }
}
```

- [ ] **Step 3: Write the client helpers**

```ts
// src/lib/dailyClient.ts
import type { ContentPost, ContentRun, KillReason } from "@/lib/content/daily/types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request_failed_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchToday(
  date: string,
): Promise<{ posts: ContentPost[]; run: ContentRun | null }> {
  return jsonOrThrow(await fetch(`/api/content/posts?date=${date}`, { cache: "no-store" }));
}

export async function patchPost(
  id: string,
  changes: { status?: ContentPost["status"]; killReason?: KillReason | null; editedBody?: string | null },
): Promise<ContentPost> {
  const { post } = await jsonOrThrow<{ post: ContentPost }>(
    await fetch(`/api/content/posts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    }),
  );
  return post;
}

export async function runDailyNow(
  force = false,
): Promise<{ posts: ContentPost[]; run: ContentRun }> {
  return jsonOrThrow(
    await fetch("/api/content/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    }),
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. `/api/content/daily` does not exist until Task 17; the
client helper only types it, so this compiles.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/content/posts src/lib/dailyClient.ts
git commit -m "feat(content): posts endpoints with a narrow client-writable surface"
```

---

### Task 16: Today panel

**Files:**
- Create: `src/components/content/PostCard.tsx`
- Create: `src/components/content/TodayPanel.tsx`
- Modify: `src/app/content/page.tsx` (render `<TodayPanel />` above the grid)

**Interfaces:**
- Consumes: `fetchToday`, `patchPost`, `runDailyNow` from `@/lib/dailyClient`; `PILLAR_META`, `FORMAT_META` from `@/lib/content/daily/craft`; `todayISO` from `@/lib/utils`.
- Produces: default-exported `<TodayPanel />` and `<PostCard post onChange />`.

`TodayPanel` fetches on mount for `todayISO()`, renders the two cards, and shows
the run state: `failed` → the error plus a Retry button; `thin` → the degraded
reason; missing entirely → a "Generate today's posts" button.

The source-route map below was verified against `src/app`: the pain bank lives at
`/pain-bank` and notes at `/notebook`, not the names you might guess.

- [ ] **Step 1: Build `PostCard`**

```tsx
"use client";

import { useState } from "react";
import { Copy, Check, Pencil, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { useStore, useVoiceProfile } from "@/lib/store";
import { patchPost } from "@/lib/dailyClient";
import { PILLAR_META, FORMAT_META } from "@/lib/content/daily/craft";
import { KILL_REASONS, type ContentPost, type KillReason } from "@/lib/content/daily/types";

/** Verified against src/app — omit the link for anything not listed. */
const SOURCE_ROUTES: Record<string, string> = {
  painPoints: "/pain-bank",
  leads: "/leads",
  interactions: "/interactions",
  projects: "/projects",
  milestones: "/projects",
  scorecards: "/scorecard",
  notes: "/notebook",
};

const KILL_LABELS: Record<KillReason, string> = {
  boring: "Boring",
  not_my_voice: "Not my voice",
  not_true: "Not true",
  wrong_angle: "Wrong angle",
  already_said: "Already said it",
};

export default function PostCard({
  post,
  onChange,
}: {
  post: ContentPost;
  onChange: (p: ContentPost) => void;
}) {
  const store = useStore();
  const profile = useVoiceProfile();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.editedBody ?? post.body);
  const [copied, setCopied] = useState(false);
  const [killing, setKilling] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [showPhrase, setShowPhrase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = post.editedBody ?? post.body;
  const failures = post.checks.filter((c) => !c.passed);

  const apply = async (changes: Parameters<typeof patchPost>[1]) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await patchPost(post.id, changes));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const save = async () => {
    setEditing(false);
    await apply({ editedBody: draft });
  };

  const kill = async (reason: KillReason) => {
    if (reason === "not_my_voice") setShowPhrase(true);
    else setKilling(false);
    await apply({ status: "killed", killReason: reason });
  };

  // A reason chip alone cannot identify an offending phrase, so this is the
  // only path by which neverSay grows from a kill.
  const addPhrase = () => {
    const value = phrase.trim().toLowerCase();
    if (!value || !profile) return;
    const next = [...new Set([...profile.neverSay, value])].slice(-60);
    store.update("voiceProfile", profile.id, { neverSay: next });
    setPhrase("");
    setShowPhrase(false);
    setKilling(false);
  };

  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{
        border: "1px solid var(--color-line)",
        borderRadius: 10,
        background: "var(--color-surface-2)",
        opacity: post.status === "killed" ? 0.5 : 1,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem]">
        <span className="badge">{PILLAR_META[post.pillar].label}</span>
        <span className="badge">{FORMAT_META[post.format].label}</span>
        {post.status === "needs_work" && (
          <span className="text-[var(--color-accent)]">needs work</span>
        )}
        {post.status === "kept" && <span className="text-[var(--color-dim)]">kept</span>}
        {post.revisions > 0 && (
          <span className="text-[var(--color-dim)]">
            {post.revisions} revision{post.revisions === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {editing ? (
        <textarea
          className="textarea"
          rows={12}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-[0.85rem] leading-relaxed text-[var(--color-ink)]">
          {shown}
        </pre>
      )}

      <div className="text-[0.72rem] text-[var(--color-dim)]">
        {post.sourceRefs.map((ref, i) => {
          const href = SOURCE_ROUTES[ref.collection];
          return (
            <span key={`${ref.collection}-${ref.id}-${i}`}>
              {i > 0 && " · "}
              From{" "}
              {href ? (
                <Link href={href} className="underline">
                  {ref.collection}
                </Link>
              ) : (
                ref.collection
              )}{" "}
              — “{ref.anchor}”
            </span>
          );
        })}
      </div>

      {failures.length > 0 && (
        <div className="flex flex-col gap-0.5 text-[0.72rem] text-[var(--color-accent)]">
          {failures.map((c) => (
            <div key={c.rule}>
              {c.rule} — {c.detail}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm" onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        {editing ? (
          <button className="btn btn-accent btn-sm" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={12} /> Edit
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => void apply({ status: "kept" })}
          disabled={busy}
        >
          <ThumbsUp size={12} /> Keep
        </button>
        <button className="btn btn-sm" onClick={() => setKilling((k) => !k)}>
          <X size={12} /> Kill
        </button>
      </div>

      {killing && (
        <div className="flex flex-wrap gap-1.5">
          {KILL_REASONS.map((r) => (
            <button key={r} className="btn btn-sm" onClick={() => void kill(r)} disabled={busy}>
              {KILL_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {showPhrase && (
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Which bit sounded wrong? (optional)"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPhrase()}
          />
          <button className="btn btn-sm" onClick={addPhrase} disabled={!phrase.trim() || !profile}>
            Add
          </button>
        </div>
      )}

      {error && <p className="text-[0.72rem] text-[var(--color-accent)]">{error}</p>}
    </div>
  );
}
```

If `.badge` is not an existing utility class in the project's CSS, replace those
two `<span className="badge">` elements with the same inline-style treatment used
by the surrounding chips in `src/app/content/page.tsx`.

- [ ] **Step 2: Build `TodayPanel`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { fetchToday, runDailyNow } from "@/lib/dailyClient";
import { todayISO } from "@/lib/utils";
import PostCard from "./PostCard";
import type { ContentPost, ContentRun } from "@/lib/content/daily/types";

export default function TodayPanel() {
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [run, setRun] = useState<ContentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchToday(todayISO());
      setPosts(data.posts);
      setRun(data.run);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await runDailyNow(true);
      setPosts(data.posts);
      setRun(data.run);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const replace = (updated: ContentPost) =>
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  return (
    <Panel title="Today">
      {loading && (
        <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && run?.status === "failed" && (
        <p className="text-[0.8rem] text-[var(--color-accent)]">
          Generation failed: {run.error}
        </p>
      )}

      {!loading && run?.status === "thin" && run.degraded.length > 0 && (
        <p className="text-[0.78rem] text-[var(--color-muted)] mb-3">{run.degraded[0]}</p>
      )}

      {!loading && posts.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[0.83rem] text-[var(--color-muted)]">
            No posts for today yet.
          </p>
          <button className="btn btn-accent btn-sm" onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate today's posts
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} onChange={replace} />
        ))}
      </div>

      {!loading && posts.length > 0 && (
        <button className="btn btn-sm mt-4" onClick={() => void generate()} disabled={generating}>
          {generating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Regenerate both
        </button>
      )}

      {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}
    </Panel>
  );
}
```

- [ ] **Step 3: Mount it**

In `src/app/content/page.tsx`, render `<TodayPanel />` directly below
`<PageHeader />` and above the existing `<div className="grid ...">`.

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`. With three voice samples and a positioning profile saved,
click **Generate today's posts**. Confirm two cards render with distinct pillars
and formats, each showing a source line. Kill one with `not_my_voice`, add a
phrase, and confirm it lands in the voice profile's `neverSay`. Reload and
confirm the status survived.

- [ ] **Step 5: Commit**

```bash
git add src/components/content/PostCard.tsx src/components/content/TodayPanel.tsx src/app/content/page.tsx
git commit -m "feat(content): today panel with the keep/kill/edit feedback loop"
```

---

# Phase 6 — Automation

Deliberately last. The engine should be producing posts worth reading before it starts producing them unattended.

---

### Task 17: Daily route, cron and middleware

**Files:**
- Create: `src/app/api/content/daily/route.ts`
- Create: `vercel.json`
- Modify: `src/middleware.ts:6`
- Modify: `.env.example`
- Modify: `src/components/content/TodayPanel.tsx` (staleness fallback)

**Interfaces:**
- Consumes: `runDaily` from `@/lib/content/daily/run`; `loadAll` from `@/lib/db/sqlite`; `recentPosts`, `savePosts`, `saveRun`, `listPosts` from `@/lib/content/daily/store`; `auth` from `@/auth`.
- Produces: `POST /api/content/daily` → `{ posts, run }`.

Authorised by **either** `Authorization: Bearer ${CRON_SECRET}` **or** an
authenticated session, so one route serves the cron and the Regenerate button.
Idempotent: returns the existing posts unless `force` is set.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/content/daily/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { loadAll } from "@/lib/db/sqlite";
import { runDaily } from "@/lib/content/daily/run";
import { chooseBriefs } from "@/lib/content/daily/brief";
import { draftPost } from "@/lib/content/daily/draft";
import { revisePost } from "@/lib/content/daily/revise";
import { listPosts, recentPosts, savePosts, saveRun, latestRun } from "@/lib/content/daily/store";
import { todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The pipeline makes up to five sequential model calls.
export const maxDuration = 300;

async function authorised(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return Boolean(await auth());
}

export async function POST(req: Request) {
  if (!(await authorised(req))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  const force = await req
    .json()
    .then((b: { force?: boolean }) => Boolean(b?.force))
    .catch(() => false);

  const today = todayISO();

  // Idempotent: the cron may fire more than once, and a retry must not
  // silently replace posts the founder has already acted on.
  if (!force) {
    const existing = await listPosts(today);
    if (existing.length > 0) {
      return NextResponse.json({ posts: existing, run: await latestRun(today) });
    }
  }

  try {
    const data = await loadAll();
    const client = new Anthropic({ apiKey });

    const { run, posts } = await runDaily({
      data,
      today,
      client,
      chooseBriefs,
      draftPost,
      revisePost,
      loadRecentPosts: recentPosts,
      persist: async (p, r) => {
        await savePosts(p);
        await saveRun(r);
      },
    });

    return NextResponse.json({ posts, run });
  } catch (err) {
    // runDaily already persisted the failed run before rethrowing.
    return apiError(UPSTREAM_FAILED, 502, err);
  }
}
```

- [ ] **Step 2: Add the cron**

```json
{
  "crons": [
    { "path": "/api/content/daily", "schedule": "0 4 * * *" }
  ]
}
```

04:00 UTC is 06:00 SAST.

- [ ] **Step 3: Let the cron past NextAuth**

`src/middleware.ts` currently fronts every path except `/api/auth`. Add the
daily route to the exclusion so the cron is not redirected to `/login` — the
`CRON_SECRET` check inside the route is the real gate:

```ts
export const config = {
  matcher: [
    // Run on all paths EXCEPT: /api/auth/*, the cron-invoked daily route,
    // /login, Next internals, and static files.
    "/((?!api/auth|api/content/daily|login|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)",
  ],
};
```

- [ ] **Step 4: Document the secret**

Append to `.env.example`:

```
# Shared secret for the Content Studio daily cron. Vercel sets this header
# automatically on cron invocations once the variable exists on the project:
#   vercel env add CRON_SECRET production
# Generate with: openssl rand -hex 32
CRON_SECRET=
```

- [ ] **Step 5: Add the staleness fallback**

Mirror the staleness pattern at `src/app/news/page.tsx:77-81`. Add to
`TodayPanel`, after the existing `load` effect:

```tsx
const [autoTried, setAutoTried] = useState(false);

// The cron may not have run — a paused deployment, a missed schedule. If it is
// past 06:00 and today has no run, kick one off once. The `autoTried` guard
// survives Strict Mode's double-invoke.
useEffect(() => {
  if (loading || autoTried || generating) return;
  if (run || posts.length > 0) return;
  if (new Date().getHours() < 6) return;
  setAutoTried(true);
  void generate();
}, [loading, autoTried, generating, run, posts.length]);
```

`generate` is defined above this effect, so either wrap it in `useCallback` or
add an `eslint-disable-next-line react-hooks/exhaustive-deps` comment as
`news/page.tsx` does at line 82.

- [ ] **Step 6: Verify**

```bash
npm test && npx tsc --noEmit && npm run build
```

Then locally, with `CRON_SECRET` set in `.env.local`:

```bash
curl -X POST http://localhost:3000/api/content/daily \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" -d '{"force":true}'
```

Expected: JSON with two posts and a run. Repeat without `force` and confirm it
returns the same posts rather than generating again.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/content/daily vercel.json src/middleware.ts .env.example src/components/content/TodayPanel.tsx
git commit -m "feat(content): daily cron, secret-gated route and staleness fallback"
```

---

### Task 18: End-to-end verification

**Files:** none created — this is a verification gate.

- [ ] **Step 1: Full suite**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 2: Cold-start behaviour**

Delete every voice sample. Click **Generate today's posts**. Expected: a clear
error naming `voice_samples` and the count needed, not a crash and not a
generic post.

- [ ] **Step 3: Rotation across days**

Force a run, then edit the two posts' `date` values in the database back by one
day and force another run. Expected: the new posts use different pillars and
formats from the previous day's.

- [ ] **Step 4: Gate behaviour under a bad model day**

Temporarily point `draftPost` at a stub returning
`"It's not a tool, it's a mindset. Let that sink in."` Expected: two revision
attempts, then a card marked `needs work` with the failed checks listed. Revert
the stub afterwards.

- [ ] **Step 5: Confirm the clobber hazard is closed**

Open the app in a tab. In a second terminal, force a daily run. Back in the
first tab, edit a lead so the client PUTs its stale snapshot. Reload. Expected:
today's posts are still there — they live outside `COLLECTIONS`.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "test(content): end-to-end verification of the daily engine"
```

---

## Deferred to a follow-up

Recorded here so they are not silently dropped:

- **Per-slot "Regenerate this one" (in the spec, not in this plan).** The spec's §6 asks for regenerating a single slot with the rejected material excluded. This plan ships "Regenerate both" instead, because per-slot regeneration needs a design decision the spec does not settle: `runDaily` chooses two briefs together and validates that they differ in pillar *and* format, so regenerating one slot alone means re-running the brief stage against a *fixed* counterpart rather than a free pair. That is a real change to `chooseBriefs`' contract, not a UI tweak. Worth doing — it deserves its own small spec addendum first. Flagged to the founder rather than quietly narrowed.
- **Dashboard widget.** The spec chose the Today panel as the single surface. A compact two-card widget on the home dashboard is a natural follow-up once the panel earns its keep.
- **News mode is a stub.** `buildLedger` returns `mode: "news"` and an empty ledger when nothing is logged. `chooseBriefs` will then have no material and fail. Wiring `newsFeed` items into `MaterialItem` shape is a small, well-bounded follow-up task — until then a completely empty database produces a clean failure rather than a bad post, which is the correct interim behaviour.
- **`neverSay` 60-entry cap** is applied on read in `run.ts`. Pruning at write time in the kill flow would be tidier.
