import { describe, it, expect } from "vitest";
import { buildMemory, validateBriefs, CHOICES_NEEDED } from "./rotation";
import { PILLARS, FORMATS, type ContentPost, type PostBrief } from "./types";

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

  it("rejects two same-day briefs sharing a pillar", () => {
    const memory = buildMemory([], today);
    const samePillar = validateBriefs(
      [brief({ slot: 1 }), brief({ slot: 2, format: "scene" })], memory,
    );
    expect(samePillar.join(" ")).toMatch(/same day/i);
  });

  it("rejects two same-day briefs sharing a format but differing in pillar", () => {
    const memory = buildMemory([], today);
    const sameFormat = validateBriefs(
      [brief({ slot: 1, pillar: "proof", format: "numbers" }),
       brief({ slot: 2, pillar: "lesson", format: "numbers" })],
      memory,
    );
    expect(sameFormat.join(" ")).toMatch(/same day/i);
    expect(sameFormat.join(" ")).toMatch(/format/i);
  });

  it("rejects two same-day briefs sharing both a pillar and a format", () => {
    const memory = buildMemory([], today);
    const both = validateBriefs(
      [brief({ slot: 1, pillar: "proof", format: "numbers" }),
       brief({ slot: 2, pillar: "proof", format: "numbers" })],
      memory,
    );
    const joined = both.join(" ");
    expect(joined).toMatch(/same day.*pillar/i);
    expect(joined).toMatch(/same day.*format/i);
  });

  it("exposes recent opening lines, most recent first, capped at thirty", () => {
    const posts = Array.from({ length: 40 }, (_, i) =>
      post({ id: `p${i}`, date: "2026-08-01", openingLine: `line ${i}` }));
    expect(buildMemory(posts, today).recentOpeners).toHaveLength(30);
  });

  it("blocks a future-dated post's pillar just as a same-day post would (fail-safe, not permanent)", () => {
    // A post dated after "today" (timezone skew, hand-entered data) must still
    // block its pillar immediately rather than slip through — this guards
    // fail-safe behaviour for future-dated data, full stop. It does NOT
    // discriminate the age clamp in rotation.ts: `age < WINDOW_DAYS` blocks
    // any non-positive age identically, so this test passes whether or not
    // the clamp exists (verified by removing it). Do not mistake this for a
    // regression guard on that line.
    const memoryOneDayFuture = buildMemory(
      [post({ date: "2026-08-05", pillar: "proof" })], today,
    );
    const memoryTenDaysFuture = buildMemory(
      [post({ date: "2026-08-14", pillar: "proof" })], today,
    );

    const outOneDayFuture = validateBriefs([brief({ slot: 1, pillar: "proof" })], memoryOneDayFuture);
    const outTenDaysFuture = validateBriefs([brief({ slot: 1, pillar: "proof" })], memoryTenDaysFuture);

    expect(outOneDayFuture.join(" ")).toMatch(/pillar/i);
    expect(outTenDaysFuture.join(" ")).toMatch(/pillar/i);
  });
});

/**
 * The windows are wider than the supply, so they exhaust on their own.
 *
 * Six pillars against a 4-day window at two posts a day consumes up to eight
 * pillar-slots per window; six formats against a 3-day window consumes six.
 * Three consecutive days of generation therefore blocks EVERY pillar and
 * EVERY format, and the brief stage is handed a constraint set with no
 * solution — the model cannot comply, both attempts are rejected, and the run
 * dies as `brief_invalid` → 502. That is what took the founder's 2026-08-12
 * generation down; the history below is the real one, read from production.
 *
 * The guardrail exists to force variety, not to deadlock. When variety is
 * genuinely impossible the correct answer is the least-recently-used option,
 * so buildMemory releases the oldest holds until the day can be filled.
 */
describe("window exhaustion", () => {
  const PROD_HISTORY: ContentPost[] = [
    post({ id: "a", date: "2026-08-11", pillar: "proof", format: "numbers" }),
    post({ id: "b", date: "2026-08-11", pillar: "build-log", format: "short-punch" }),
    post({ id: "c", date: "2026-08-10", pillar: "client-pain", format: "claim-defence" }),
    post({ id: "d", date: "2026-08-10", pillar: "contrarian", format: "one-idea" }),
    post({ id: "e", date: "2026-08-10", pillar: "teardown", format: "before-after" }),
    post({ id: "f", date: "2026-08-10", pillar: "lesson", format: "scene" }),
  ];
  const today = "2026-08-12";

  it("always leaves enough pillars and formats to fill the day", () => {
    const memory = buildMemory(PROD_HISTORY, today);
    expect(PILLARS.filter((p) => !memory.recentPillars.has(p)).length)
      .toBeGreaterThanOrEqual(CHOICES_NEEDED);
    expect(FORMATS.filter((f) => !memory.recentFormats.has(f)).length)
      .toBeGreaterThanOrEqual(CHOICES_NEEDED);
  });

  it("leaves at least one brief pair that validates", () => {
    // The bug in one assertion: on 2026-08-12 every one of the 1296 possible
    // pairs was rejected, so no answer existed for the model to give.
    const memory = buildMemory(PROD_HISTORY, today);
    const pairs = PILLARS.flatMap((p1) => FORMATS.flatMap((f1) =>
      PILLARS.flatMap((p2) => FORMATS.map((f2) =>
        validateBriefs([
          brief({ slot: 1, pillar: p1, format: f1 }),
          brief({ slot: 2, pillar: p2, format: f2 }),
        ], memory),
      ))));
    expect(pairs.filter((v) => v.length === 0).length).toBeGreaterThan(0);
  });

  it("releases the oldest hold first, keeping the freshest rotation intact", () => {
    // 08-10's holds are closer to expiring than 08-11's, so they come back
    // first. Releasing a pillar used yesterday would repeat the newest post.
    // Asserted as exact sets, not just "proof is absent": with every option
    // blocked, a check that merely counts what is free passes for any choice
    // of which two are released, including the worst one.
    const memory = buildMemory(PROD_HISTORY, today);
    expect(memory.released.pillars).toEqual(["client-pain", "contrarian"]);
    expect(memory.released.formats).toEqual(["scene", "one-idea"]);
    expect(memory.recentPillars.has("proof")).toBe(true);
    expect(memory.recentPillars.has("build-log")).toBe(true);
    expect(memory.recentFormats.has("numbers")).toBe(true);
    expect(memory.recentFormats.has("short-punch")).toBe(true);
  });

  it("reports what it released so the run can say the rotation was relaxed", () => {
    const memory = buildMemory(PROD_HISTORY, today);
    expect(memory.released.pillars.length).toBeGreaterThan(0);
    expect(memory.released.formats.length).toBeGreaterThan(0);
  });

  it("releases nothing while the windows still leave room", () => {
    const memory = buildMemory(
      [post({ date: "2026-08-11", pillar: "proof", format: "numbers" })], today,
    );
    expect(memory.released).toEqual({ pillars: [], formats: [] });
    expect(memory.recentPillars.has("proof")).toBe(true);
  });

  it("never releases a source record — reuse is an editorial failure, not a rotation one", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      post({ id: `s${i}`, date: "2026-08-11",
             sourceRefs: [{ collection: "painPoints", id: `pp${i}`, anchor: "a" }] }));
    const memory = buildMemory(many, today);
    expect(memory.recentSources.size).toBe(30);
  });
});
