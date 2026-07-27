import { describe, it, expect } from "vitest";
import { searchThreads } from "@/lib/advisor/searchThreads";

function thread(title: string, ...contents: string[]) {
  return { title, messages: contents.map((content) => ({ content })) };
}

describe("searchThreads", () => {
  it("returns every thread with no matches for an empty query", () => {
    const threads = [thread("Alpha", "hello"), thread("Beta", "world")];
    const out = searchThreads(threads, "");
    expect(out.map((r) => r.thread.title)).toEqual(["Alpha", "Beta"]);
    expect(out.every((r) => r.matchCount === 0)).toBe(true);
  });

  it("treats a whitespace-only query as empty", () => {
    const threads = [thread("Alpha", "hello")];
    expect(searchThreads(threads, "   ")).toHaveLength(1);
  });

  it("includes a thread matching on title alone with a zero match count", () => {
    const threads = [thread("Quillmere follow-up", "nothing relevant here")];
    const out = searchThreads(threads, "quillmere");
    expect(out).toHaveLength(1);
    expect(out[0].matchCount).toBe(0);
  });

  it("counts the messages that contain the term", () => {
    const threads = [
      thread("Pipeline", "Quillmere is cold", "unrelated", "chase Quillmere friday"),
    ];
    const out = searchThreads(threads, "quillmere");
    expect(out[0].matchCount).toBe(2);
  });

  it("counts a message once even when it contains the term several times", () => {
    const threads = [thread("Pipeline", "Quillmere, Quillmere, Quillmere")];
    expect(searchThreads(threads, "quillmere")[0].matchCount).toBe(1);
  });

  it("includes a thread when its terms are spread across different messages", () => {
    const threads = [thread("Pipeline", "call Quillmere", "send the proposal")];
    const out = searchThreads(threads, "quillmere proposal");
    expect(out).toHaveLength(1);
    expect(out[0].matchCount).toBe(2);
  });

  it("excludes a thread when one term is missing", () => {
    const threads = [thread("Pipeline", "call Quillmere", "send the proposal")];
    expect(searchThreads(threads, "quillmere invoice")).toEqual([]);
  });

  it("matches regardless of case on either side", () => {
    const threads = [thread("Pipeline", "QUILLMERE Capital")];
    expect(searchThreads(threads, "QuIlLmErE")).toHaveLength(1);
  });

  it("matches a term found only in the title when another is in a message", () => {
    const threads = [thread("Quillmere", "send the proposal")];
    const out = searchThreads(threads, "quillmere proposal");
    expect(out).toHaveLength(1);
    expect(out[0].matchCount).toBe(1);
  });

  it("preserves input order", () => {
    const threads = [thread("Z", "match"), thread("A", "match"), thread("M", "match")];
    expect(searchThreads(threads, "match").map((r) => r.thread.title)).toEqual(["Z", "A", "M"]);
  });

  it("returns nothing when no thread matches", () => {
    expect(searchThreads([thread("Alpha", "hello")], "zzz")).toEqual([]);
  });

  it("handles threads with no messages", () => {
    expect(searchThreads([thread("Quillmere")], "quillmere")).toHaveLength(1);
    expect(searchThreads([thread("Quillmere")], "proposal")).toEqual([]);
  });
});
