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
