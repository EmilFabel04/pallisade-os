import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FathomAuthError, FathomRateLimitError, FathomError, type FathomMeeting } from "./client";

const { mockList, mockTranscript } = vi.hoisted(() => ({
  mockList: vi.fn(), mockTranscript: vi.fn(),
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, listMeetings: mockList, getTranscript: mockTranscript };
});

import { FATHOM_TOOLS, FATHOM_TOOL_NAMES, resolveFathomTool } from "./tools";

const acme: FathomMeeting = {
  recording_id: "rec-acme",
  title: "Acme discovery call",
  created_at: "2026-08-10T09:00:00Z",
  calendar_invitees: [
    { name: "Sam Patel", email: "sam@acme.co", email_domain: "acme.co", is_external: true },
  ],
  default_summary: { template_name: "General", markdown_formatted: "They pushed back on the setup fee." },
  action_items: [{ description: "Send revised quote", completed: false, assignee: { name: "Emil" } }],
  crm_matches: { companies: [{ name: "Acme Ltd", domain: "acme.co" }], contacts: [], deals: [] },
};

const globex: FathomMeeting = {
  recording_id: "rec-globex",
  title: "Globex weekly",
  created_at: "2026-08-11T09:00:00Z",
  calendar_invitees: [{ name: "Dana", email: "dana@globex.io", email_domain: "globex.io" }],
  default_summary: { markdown_formatted: "Timeline slipping on the ingest work." },
  crm_matches: { companies: [{ name: "Globex" }] },
};

// No crm_matches at all — company matching must still work off the invitee email.
const initech: FathomMeeting = {
  recording_id: "rec-initech",
  title: "Intro chat",
  created_at: "2026-08-12T09:00:00Z",
  calendar_invitees: [{ name: "Peter", email: "peter@initech.com", email_domain: "initech.com" }],
  default_summary: { markdown_formatted: "Budget not approved yet." },
};

const onePage = (items: FathomMeeting[]) => ({ items, nextCursor: null });

beforeEach(() => {
  mockList.mockReset();
  mockTranscript.mockReset();
  process.env.FATHOM_API_KEY = "test-key";
});
afterEach(() => { delete process.env.FATHOM_API_KEY; });

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

describe("FATHOM_TOOLS", () => {
  it("declares exactly the two tools, requiring a recordingId to read one", () => {
    expect(FATHOM_TOOLS.map((t) => t.name).sort())
      .toEqual(["fathom_read_meeting", "fathom_search_meetings"]);
    expect([...FATHOM_TOOL_NAMES].sort())
      .toEqual(["fathom_read_meeting", "fathom_search_meetings"]);
    const read = FATHOM_TOOLS.find((t) => t.name === "fathom_read_meeting")!;
    expect(read.input_schema.required).toContain("recordingId");
  });
});

describe("fathom_search_meetings", () => {
  it("returns real meeting data, not just a shape", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    const meetings = out.meetings as Record<string, unknown>[];
    expect(meetings[0]).toMatchObject({ id: "rec-acme", title: "Acme discovery call" });
    expect(String(meetings[0].summaryExcerpt)).toContain("pushed back on the setup fee");
  });

  it("filters by company via crm_matches", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    // "Acme Ltd" lives only in crm_matches.companies[0].name — it appears in no
    // title and no invitee field, so this can only pass via the CRM branch.
    const out = parse(await resolveFathomTool("fathom_search_meetings", { company: "Acme Ltd" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-acme"]);
    expect(out.matched).toBe(1);
    expect(out.scanned).toBe(3);
  });

  it("filters by company via the invitee email when crm_matches is absent", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { company: "initech" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-initech"]);
  });

  it("filters by query against the summary, not only the title", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { query: "timeline slipping" }));
    expect((out.meetings as { id: string }[]).map((m) => m.id)).toEqual(["rec-globex"]);
  });

  it("ANDs company and query", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {
      company: "Acme", query: "timeline slipping",
    }));
    expect(out.meetings).toEqual([]);
  });

  it("returns every meeting in the window when neither filter is given", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(out.meetings).toHaveLength(3);
    expect(out.truncated).toBe(false);
    expect(out.scanned).toBe(3);
  });

  it("asks the API for the requested window", async () => {
    mockList.mockResolvedValue(onePage([]));
    await resolveFathomTool("fathom_search_meetings", { sinceDays: 7 });
    const since = new Date(String(mockList.mock.calls[0][0].createdAfter)).getTime();
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });

  it("honours limit after filtering", async () => {
    mockList.mockResolvedValue(onePage([acme, globex, initech]));
    const out = parse(await resolveFathomTool("fathom_search_meetings", { limit: 2 }));
    expect(out.meetings).toHaveLength(2);
    // matched (3) exceeds the rows actually returned (2) — the model needs this
    // to know there is more than the two rows it was shown.
    expect(out.matched).toBe(3);
    expect(out.scanned).toBe(3);
  });

  // Silent truncation is the failure this repo keeps producing: a partial scan
  // rendered as a complete answer.
  it("stops at the page cap and says so", async () => {
    mockList.mockResolvedValue({ items: [acme], nextCursor: "more" });
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(mockList).toHaveBeenCalledTimes(5);
    expect(out.truncated).toBe(true);
    expect(out.scanned).toBe(5);
  });

  it("does not claim truncation when the window fits", async () => {
    mockList
      .mockResolvedValueOnce({ items: [acme], nextCursor: "p2" })
      .mockResolvedValueOnce({ items: [globex], nextCursor: null });
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(out.truncated).toBe(false);
    expect(out.scanned).toBe(2);
  });

  it("never fetches a transcript while searching", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    await resolveFathomTool("fathom_search_meetings", {});
    expect(mockTranscript).not.toHaveBeenCalled();
  });
});

describe("fathom_read_meeting", () => {
  it("returns the full summary and action items", async () => {
    mockList.mockResolvedValue(onePage([acme, globex]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(out.title).toBe("Acme discovery call");
    expect(String(out.summary)).toContain("pushed back on the setup fee");
    expect(out.actionItems).toEqual([{ description: "Send revised quote", completed: false, assignee: "Emil" }]);
  });

  it("omits the transcript and makes no transcript call unless asked", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(out.transcript).toBeUndefined();
    expect(mockTranscript).not.toHaveBeenCalled();
  });

  it("includes a speaker-attributed transcript when asked", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    mockTranscript.mockResolvedValue([
      { speaker: { display_name: "Sam Patel" }, text: "The setup fee is the problem", timestamp: "00:04:10" },
    ]);
    const out = parse(await resolveFathomTool("fathom_read_meeting", {
      recordingId: "rec-acme", includeTranscript: true,
    }));
    expect(mockTranscript).toHaveBeenCalledWith("rec-acme");
    expect(String(out.transcript)).toContain("Sam Patel");
    expect(String(out.transcript)).toContain("The setup fee is the problem");
  });

  it("clips an over-budget transcript rather than blowing the turn's budget", async () => {
    mockList.mockResolvedValue(onePage([acme]));
    mockTranscript.mockResolvedValue(
      Array.from({ length: 4000 }, () => ({ speaker: { display_name: "X" }, text: "y".repeat(50) })),
    );
    const out = parse(await resolveFathomTool("fathom_read_meeting", {
      recordingId: "rec-acme", includeTranscript: true,
    }));
    expect(String(out.transcript)).toMatch(/\[truncated\]$/);
    expect(String(out.transcript).length).toBeLessThan(41000);
  });

  // The likeliest cause is a window that is too narrow, so the message says so.
  it("tells the model to widen the window when the id is not in it", async () => {
    mockList.mockResolvedValue(onePage([globex]));
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(String(out.error)).toMatch(/sinceDays/);
  });

  // The opposite of the "widen" case above: when the scan itself was capped
  // before it could reach the id, a miss is not proof of absence, and the fix
  // is to narrow the window (bring more of it inside the 5-page cap), not widen it.
  it("tells the model to narrow, not widen, the window when the scan itself was capped", async () => {
    mockList.mockResolvedValue({ items: [globex], nextCursor: "more" });
    const out = parse(await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme" }));
    expect(String(out.error)).toMatch(/narrow/i);
    expect(String(out.error)).not.toMatch(/larger/i);
  });

  it("asks the API for the requested window", async () => {
    mockList.mockResolvedValue(onePage([]));
    await resolveFathomTool("fathom_read_meeting", { recordingId: "rec-acme", sinceDays: 7 });
    const since = new Date(String(mockList.mock.calls[0][0].createdAfter)).getTime();
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });
});

describe("failures become prose the model can relay", () => {
  it("reports a rejected key", async () => {
    mockList.mockRejectedValue(new FathomAuthError());
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/API key/i);
  });

  it("reports a rate limit", async () => {
    mockList.mockRejectedValue(new FathomRateLimitError());
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/rate limit/i);
  });

  it("reports an unreachable API without relaying the status text", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockList.mockRejectedValue(new FathomError(503));
      const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
      expect(String(out.error)).toMatch(/could not be reached/i);
      expect(String(out.error)).not.toContain("503");
      // The status still gets logged server-side — just not into the model-visible string.
      expect(errSpy).toHaveBeenCalledWith("[fathom] request failed:", 503);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("reports a missing key rather than throwing", async () => {
    delete process.env.FATHOM_API_KEY;
    const out = parse(await resolveFathomTool("fathom_search_meetings", {}));
    expect(String(out.error)).toMatch(/FATHOM_API_KEY/);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("reports an unknown tool name", async () => {
    const out = parse(await resolveFathomTool("fathom_nope", {}));
    expect(String(out.error)).toContain("unknown tool");
  });
});
