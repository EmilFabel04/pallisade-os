/* ============================================================
   The Advisor route runs on the shared agent runtime (getAgent + runAgent),
   same as Brain (src/app/api/brain/route.test.ts). getAgent -> loadRegistry
   -> loadOverrides is DB-backed (getClient() defaults to
   file:data/pallisade.db, the founder's real production database). Stub
   loadOverrides at the module boundary so this file never touches the DB.

   The Anthropic SDK is stubbed the same way. emailToolsAvailable /
   connectedEmails / resolveEmailTool and calendarToolsAvailable /
   resolveCalendarTool are DB- and network-backed (Gmail/Calendar APIs) —
   stubbed at the module boundary so tests control exactly what they
   resolve to, and so capabilities.ts's dispatch (which imports the same
   modules) never makes a real call either.
   ============================================================ */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { AdvisorSnapshot } from "@/lib/types";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
const overridesState = vi.hoisted(() => ({ reject: false }));
const { mockEmailAvailable, mockConnectedEmails, mockResolveEmailTool } = vi.hoisted(() => ({
  mockEmailAvailable: vi.fn(),
  mockConnectedEmails: vi.fn(),
  mockResolveEmailTool: vi.fn(),
}));
const { mockCalendarAvailable, mockResolveCalendarTool } = vi.hoisted(() => ({
  mockCalendarAvailable: vi.fn(),
  mockResolveCalendarTool: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () =>
    overridesState.reject
      ? Promise.reject(new Error("db unavailable"))
      : Promise.resolve(new Map<string, string>()),
}));

vi.mock("@/lib/gmail/advisorEmail", () => ({
  emailToolsAvailable: mockEmailAvailable,
  connectedEmails: mockConnectedEmails,
  resolveEmailTool: mockResolveEmailTool,
}));

vi.mock("@/lib/calendar/advisorCalendar", () => ({
  calendarToolsAvailable: mockCalendarAvailable,
  resolveCalendarTool: mockResolveCalendarTool,
}));

import { GET, POST } from "@/app/api/advisor/route";
import { resetRegistryCache } from "@/lib/agents/registry";

describe("advisor route", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/advisor/route.ts"), "utf8");

  it("no longer contains its own tool-use loop", () => {
    expect(src).not.toMatch(/MAX_ITERATIONS/);
    expect(src).not.toMatch(/stop_reason/);
  });

  it("delegates to the agent runtime", () => {
    expect(src).toMatch(/runAgent/);
  });

  it("still returns queued proposals to the client", () => {
    expect(src).toMatch(/actions/);
  });
});

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  mockCreate.mockReset();
  overridesState.reject = false;
  mockEmailAvailable.mockReset().mockResolvedValue(false);
  mockConnectedEmails.mockReset().mockResolvedValue([]);
  mockResolveEmailTool.mockReset();
  mockCalendarAvailable.mockReset().mockResolvedValue(false);
  mockResolveCalendarTool.mockReset();
  resetRegistryCache();
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const emptySnapshot = {} as AdvisorSnapshot;

const call = (body: unknown) =>
  POST(
    new Request("http://x/api/advisor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const textResponse = (t: string) => ({
  content: [{ type: "text", text: t }],
  stop_reason: "end_turn",
});

const msgs = [{ role: "user" as const, content: "hi" }];

describe("GET /api/advisor", () => {
  it("reports configured + the default model", async () => {
    const json = await (await GET()).json();
    expect(json.configured).toBe(true);
    expect(json.model).toBe("claude-sonnet-4-6");
  });

  it("reports unconfigured with no key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const json = await (await GET()).json();
    expect(json.configured).toBe(false);
  });
});

describe("POST /api/advisor — error semantics", () => {
  it("503 agent_unconfigured with no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await call({ messages: msgs, snapshot: emptySnapshot });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("agent_unconfigured");
  });

  it("400 bad_request on invalid JSON", async () => {
    const res = await POST(new Request("http://x/api/advisor", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("400 missing_snapshot when snapshot is absent — rejected before any upstream call", async () => {
    const res = await call({ messages: msgs });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_snapshot");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("404 agent_not_found for an unknown agentId", async () => {
    const res = await call({ agentId: "nope", messages: msgs, snapshot: emptySnapshot });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("agent_not_found");
  });

  it("502 agent_failed, and logs the cause, when the registry fails for a reason OTHER than an unknown id", async () => {
    overridesState.reject = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call({ messages: msgs, snapshot: emptySnapshot });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toBe("agent_failed");
      // A bare catch that relabels every registry failure "not found" would
      // report 404 with an empty console — this is the regression test.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("502 agent_failed, and never leaks the raw upstream message, when the model call throws", async () => {
    mockCreate.mockRejectedValue(new Error("some upstream secret detail"));
    const res = await call({ messages: msgs, snapshot: emptySnapshot });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("agent_failed");
    expect(JSON.stringify(json)).not.toMatch(/upstream secret detail/);
  });
});

describe("POST /api/advisor — agent resolution", () => {
  it("defaults to sales-advisor with no agentId", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs, snapshot: emptySnapshot });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["query_leads", "create_task", "list_projects", "get_project_context"]),
    );
  });

  it("an explicit agentId of sales-advisor resolves the same agent", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ agentId: "sales-advisor", messages: msgs, snapshot: emptySnapshot });
    expect(mockCreate).toHaveBeenCalled();
  });
});

describe("POST /api/advisor — maxTokens", () => {
  it("passes max_tokens: 2048 to messages.create, not the runtime's 4096 default", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs, snapshot: emptySnapshot });
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(2048);
  });
});

describe("POST /api/advisor — response shape", () => {
  it("returns content, actions and stoppedBy", async () => {
    mockCreate.mockResolvedValue(textResponse("the answer"));
    const res = await call({ messages: msgs, snapshot: emptySnapshot });
    const json = await res.json();
    expect(json.content).toBe("the answer");
    expect(json.actions).toEqual([]);
    expect(json.stoppedBy).toBe("end");
  });

  it("substitutes a fallback message when the model returns no text and queues nothing", async () => {
    mockCreate.mockResolvedValue({ content: [], stop_reason: "end_turn" });
    const res = await call({ messages: msgs, snapshot: emptySnapshot });
    const json = await res.json();
    expect(json.content).toBe("I couldn't produce a response — try rephrasing.");
  });

  it("a queued write proposal comes back in actions, with a confirmation fallback when there's no trailing text", async () => {
    // Turn 1: the model calls create_task with no accompanying text and stops.
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "tool_use", id: "tu_1", name: "create_task", input: { title: "Follow up with Acme" } },
      ],
      stop_reason: "tool_use",
    });
    mockCreate.mockResolvedValueOnce({ content: [], stop_reason: "end_turn" });

    const res = await call({ messages: msgs, snapshot: emptySnapshot });
    const json = await res.json();

    expect(json.actions).toHaveLength(1);
    expect(json.actions[0].tool).toBe("create_task");
    expect(json.actions[0].description).toContain("Follow up with Acme");
    expect(json.content).toBe("I've queued the action(s) below for your confirmation.");
  });
});

describe("POST /api/advisor — conditional email/calendar appendices", () => {
  it("neither integration connected: no email or calendar tools, no email/calendar text in the prompt", async () => {
    mockEmailAvailable.mockResolvedValue(false);
    mockCalendarAvailable.mockResolvedValue(false);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({ messages: msgs, snapshot: emptySnapshot });

    const call0 = mockCreate.mock.calls[0][0];
    const toolNames = call0.tools.map((t: { name: string }) => t.name);
    expect(toolNames).not.toContain("query_emails");
    expect(toolNames).not.toContain("list_inboxes");
    expect(toolNames).not.toContain("query_calendar");
    expect(toolNames).not.toContain("create_calendar_event");
    expect(call0.system).not.toMatch(/query_emails/);
    expect(call0.system).not.toMatch(/Google Calendar is connected\./);
    expect(mockEmailAvailable).toHaveBeenCalledTimes(1);
    expect(mockCalendarAvailable).toHaveBeenCalledTimes(1);
    expect(mockConnectedEmails).not.toHaveBeenCalled();
  });

  it("email connected only: email tools + appendix present, calendar text absent", async () => {
    mockEmailAvailable.mockResolvedValue(true);
    mockConnectedEmails.mockResolvedValue(["founder@pallisade.io"]);
    mockCalendarAvailable.mockResolvedValue(false);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({ messages: msgs, snapshot: emptySnapshot });

    const call0 = mockCreate.mock.calls[0][0];
    const toolNames = call0.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("query_emails");
    expect(toolNames).not.toContain("query_calendar");
    expect(call0.system).toContain("Connected Gmail inboxes: founder@pallisade.io.");
    expect(call0.system).toContain("Use query_emails");
    expect(call0.system).not.toMatch(/Google Calendar is connected\./);
  });

  it("calendar connected only: calendar tools + appendix present, email text absent", async () => {
    mockEmailAvailable.mockResolvedValue(false);
    mockCalendarAvailable.mockResolvedValue(true);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({ messages: msgs, snapshot: emptySnapshot });

    const call0 = mockCreate.mock.calls[0][0];
    const toolNames = call0.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("query_calendar");
    // create_calendar_event rides with `writes`, gated on calendarEnabled.
    expect(toolNames).toContain("create_calendar_event");
    expect(toolNames).not.toContain("query_emails");
    expect(call0.system).toContain("Google Calendar is connected.");
    expect(call0.system).not.toMatch(/query_emails/);
  });

  it("both connected: system prompt reconstructs byte-for-byte against an independent rebuild of the pre-runtime route's string", async () => {
    mockEmailAvailable.mockResolvedValue(true);
    mockConnectedEmails.mockResolvedValue(["founder@pallisade.io", "sales@pallisade.io"]);
    mockCalendarAvailable.mockResolvedValue(true);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({
      messages: msgs,
      snapshot: emptySnapshot,
      context: { businessName: "Pallisade Data", founderName: "the founder" },
    });

    const actualSystem = mockCreate.mock.calls[0][0].system as string;

    // Independent reconstruction: read the agent-file body directly off disk
    // (not by importing anything the route imports) and rebuild the exact
    // pre-runtime advisor/route.ts template — same substitutions, same
    // ordering (base body, then email block, then calendar block) — so this
    // assertion catches a wrong separator/ordering/text bug rather than
    // trivially re-deriving the same string the route already builds.
    const raw = readFileSync(join(process.cwd(), "src/agents/sales-advisor.md"), "utf8");
    const bodyOnly = raw.replace(/^---[\s\S]*?---\n/, "").trim();
    const today = new Date().toISOString().slice(0, 10);
    const businessName = "Pallisade Data";
    const founderName = "the founder";
    const services =
      "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

    let expected = bodyOnly
      .split("{{today}}").join(today)
      .split("{{businessName}}").join(businessName)
      .split("{{founderName}}").join(founderName)
      .split("{{services}}").join(services);

    expected +=
      `\n\nConnected Gmail inboxes: founder@pallisade.io, sales@pallisade.io. Use query_emails ` +
      `(Gmail search syntax) or list_inboxes to read real email when the founder asks about their ` +
      `inbox, a sender, or recent messages — never invent email content.\n\n` +
      `To find people who have gone quiet, use audit_sent_followups — it reads real SENT mail, ` +
      `excludes Apollo mailwarming, and buckets each recipient as 'awaiting_you' (they replied and are ` +
      `waiting on the founder — lead with these), 'no_reply' (never came back), or 'stalled' (they ` +
      `replied but he answered last and a nudge is still judged owed). Report the names and days since ` +
      `contact it returns; the company is derived from the email domain, so treat it as a hint rather ` +
      `than a verified name. Then propose a create_task follow-up for each person worth chasing, so the ` +
      `founder can confirm them. Cross-reference query_leads to say whether each person is already in ` +
      `the pipeline. Whether a thread was included and how urgently it needs a nudge is judged per ` +
      `thread by Jev when a TypeSafe key is configured; without one, or wherever Jev failed on a given ` +
      `thread, judging degrades to a keyword heuristic with no urgency ranking — judgeStats.mode says ` +
      `which ran, and degraded (with judgeStats.failures) says whether any thread fell back mid-run. ` +
      `If followUps looks thin, explain why from the counts rather than guessing: excludedByJudge is ` +
      `how many threads Jev decided weren't the founder's own outreach; notNudgeworthy is how many were ` +
      `judged concluded (deal closed, declined, meeting booked) and so need no follow-up; ` +
      `excludedSignoffOnly is how many the keyword heuristic dropped for failing both the subject-` +
      `mentions-Pallisade and signed-off-as-Emil rules — this one only fires in heuristic mode, or for ` +
      `an individual thread where Jev failed and the fallback also excluded it. It is nonzero only ` +
      `in heuristic mode or where individual threads fell back. And say plainly, in your own words, whenever any of ` +
      `these are set — coverage may be incomplete and the founder should know why: cappedReasons "cap" ` +
      `or "per_inbox" means the thread ceiling (cite the cap value) was reached and older mail wasn't ` +
      `read; "listing_failure" means an inbox couldn't be read at all — a failure, not a coverage limit; ` +
      `"empty_page_bail" means paging stopped early on a narrow query and there may be more behind it; ` +
      `listingFailures > 0 means that many inboxes couldn't be read; fetchFailures > 0 means that many ` +
      `threads were skipped; labelLookupFailed means the mailwarming safety net was inactive for an ` +
      `inbox, so a warming thread could have slipped through.`;

    expected +=
      `\n\nGoogle Calendar is connected. Use query_calendar to read upcoming meetings, and ` +
      `create_calendar_event to propose booking a call or follow-up (confirm-gated, like other writes). ` +
      `Resolve relative times against today's date and pass a full ISO date-time for start.`;

    expect(actualSystem).toBe(expected);
  });
});

describe("POST /api/advisor — no unsubstituted placeholder ever reaches the model", () => {
  it("every {{token}} in the persona body is rendered before the system prompt is sent", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs, snapshot: emptySnapshot });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).not.toMatch(/\{\{/);
    expect(system).toContain("the founder");
  });

  it("grants the fathom tools when the API key is set", async () => {
    process.env.FATHOM_API_KEY = "test-key";
    try {
      await call({ messages: msgs, snapshot: emptySnapshot });
      const tools = (mockCreate.mock.calls[0][0].tools as { name: string }[]).map((t) => t.name);
      expect(tools).toContain("fathom_search_meetings");
      expect(tools).toContain("fathom_read_meeting");
    } finally {
      delete process.env.FATHOM_API_KEY;
    }
  });

  // The gate, from the route's side. Without it the advisor receives two tools
  // that answer every call "not connected" and relays that to the founder.
  it("grants no fathom tools when the API key is absent", async () => {
    delete process.env.FATHOM_API_KEY;
    await call({ messages: msgs, snapshot: emptySnapshot });
    const tools = (mockCreate.mock.calls[0][0].tools as { name: string }[]).map((t) => t.name);
    expect(tools.filter((n) => n.startsWith("fathom_"))).toEqual([]);
  });
});
