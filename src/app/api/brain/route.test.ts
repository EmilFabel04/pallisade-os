/* ============================================================
   The Brain route runs on the shared agent runtime (getAgent + runAgent).
   getAgent -> loadRegistry -> loadOverrides is DB-backed (getClient()
   defaults to file:data/pallisade.db, the founder's real production
   database). Stub loadOverrides at the module boundary so this file never
   touches the DB. See the task brief's "Database hazard" section and the
   same pattern in src/lib/agents/roster.test.ts and
   src/app/api/agents/route.test.ts.

   The Anthropic SDK is stubbed the same way (src/app/api/ai/route.test.ts)
   so no test makes a real network call. emailToolsAvailable/
   calendarToolsAvailable are DB-backed too (src/lib/gmail/accounts.ts) —
   stubbed at the module boundary for the same reason, which also lets
   individual tests control what they resolve to.
   ============================================================ */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { AgentSpec } from "@/lib/agents/types";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
const overridesState = vi.hoisted(() => ({ reject: false }));
const { mockEmailAvailable, mockCalendarAvailable } = vi.hoisted(() => ({
  mockEmailAvailable: vi.fn(),
  mockCalendarAvailable: vi.fn(),
}));
// The route now loads a snapshot server-side for any agent declaring `crm`
// (the CRM read resolvers need one and Brain has no client snapshot). loadAll
// reads the founder's REAL production DB — stub it at the module boundary, for
// the same reason loadOverrides is stubbed above.
const { mockLoadAll } = vi.hoisted(() => ({ mockLoadAll: vi.fn() }));
// The route now resolves the Drive account server-side too. listAccounts reads
// the founder's REAL connected-accounts table and searchFiles/readFileContent
// call the Google Drive API — both stubbed at the module boundary, same
// reasoning as loadAll and loadOverrides above.
const { mockListAccounts } = vi.hoisted(() => ({ mockListAccounts: vi.fn() }));
const { mockSearchFiles, mockReadFileContent } = vi.hoisted(() => ({
  mockSearchFiles: vi.fn(),
  mockReadFileContent: vi.fn(),
}));
// Lets one test substitute a custom AgentSpec (e.g. one that declares the
// "email" capability group, which no shipped Brain persona does today) while
// every other test still exercises the real registry against src/agents.
const registryOverride = vi.hoisted(() => ({ spec: null as AgentSpec | null }));

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
}));

vi.mock("@/lib/calendar/advisorCalendar", () => ({
  calendarToolsAvailable: mockCalendarAvailable,
}));

vi.mock("@/lib/db/sqlite", () => ({ loadAll: mockLoadAll }));

vi.mock("@/lib/gmail/accounts", () => ({ listAccounts: mockListAccounts }));

vi.mock("@/lib/drive/driveApi", () => ({
  searchFiles: mockSearchFiles,
  readFileContent: mockReadFileContent,
}));

vi.mock("@/lib/agents/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/registry")>();
  return {
    ...actual,
    getAgent: async (id: string) => {
      if (registryOverride.spec && id === registryOverride.spec.id) return registryOverride.spec;
      return actual.getAgent(id);
    },
  };
});

import { GET, POST } from "@/app/api/brain/route";
import { resolveAvailability } from "@/lib/brain/availability";
import { resetRegistryCache, AgentNotFound } from "@/lib/agents/registry";

const savedKey = process.env.ANTHROPIC_API_KEY;
const savedModel = process.env.BRAIN_MODEL;
const savedGoogleId = process.env.GOOGLE_CLIENT_ID;
const savedGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;

/** A connected account whose grant includes Drive read scope. */
const driveAccount = () => ({
  id: "gm_drive", email: "founder@pallisade.io",
  tokens: { scope: "https://www.googleapis.com/auth/drive.readonly" },
  createdAt: "", updatedAt: "",
});

/** Connected, but Gmail-only — no Drive scope in the grant. */
const gmailOnlyAccount = () => ({
  id: "gm_mail", email: "founder@pallisade.io",
  tokens: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
  createdAt: "", updatedAt: "",
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BRAIN_MODEL;
  // isConfigured() gates the Drive resolution; without these the resolver
  // short-circuits to null and no Drive test could ever be green.
  process.env.GOOGLE_CLIENT_ID = "test-google-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  mockCreate.mockReset();
  overridesState.reject = false;
  registryOverride.spec = null;
  mockEmailAvailable.mockReset().mockResolvedValue(false);
  mockCalendarAvailable.mockReset().mockResolvedValue(false);
  mockLoadAll.mockReset().mockResolvedValue(snapshotFixture());
  mockListAccounts.mockReset().mockResolvedValue([]);
  mockSearchFiles.mockReset();
  mockReadFileContent.mockReset();
  resetRegistryCache();
});

/** What loadAll() actually returns: EVERY collection, not just the ones the
 *  read tools touch. The route narrows it through buildSnapshot, so the
 *  fixture has to carry the collections that must NOT survive that narrowing
 *  (brainThreads, notes, voiceSamples) or the narrowing is never exercised. */
const snapshotFixture = () => ({
  leads: [{
    id: "lead_1", company: "Lanternpost Capital", contactName: "A", contactRole: "COO",
    email: "", phone: "", linkedinUrl: "", industry: "asset management", companyType: "",
    source: "referral", status: "proposal", quality: "high", painPoint: "manual month-end pack",
    objection: "", buyingSignal: "asked for pricing", lastContact: "2026-08-01",
    nextFollowUp: "2026-08-20", notes: "", solutionIdea: "", estimatedValue: 180000, owner: "",
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  }],
  interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [],
  quotes: [], comparables: [], milestones: [], dialLists: [],
  conversations: [], playbooks: [], targets: [], positioningProfiles: [],
  voiceSamples: [{ id: "vs_1", text: "PRIVATE WRITING SAMPLE" }],
  voiceProfile: [], contentThreads: [],
  brainThreads: [{ id: "bt_1", title: "PRIVATE THREAD", messages: [] }],
  newsFeed: [], newsInterests: [], newsBookmarks: [],
  notes: [{ id: "n_1", body: "PRIVATE NOTE" }],
  metricEntries: [], projectThreads: [],
  settings: { businessName: "P", founderName: "E" },
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.BRAIN_MODEL;
  else process.env.BRAIN_MODEL = savedModel;
  if (savedGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = savedGoogleId;
  if (savedGoogleSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = savedGoogleSecret;
});

const call = (body: unknown) =>
  POST(
    new Request("http://x/api/brain", {
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

describe("GET /api/brain", () => {
  it("reports configured + the default model", async () => {
    const json = await (await GET()).json();
    expect(json.configured).toBe(true);
    expect(json.model).toBe("claude-sonnet-4-6");
  });

  it("reports the BRAIN_MODEL override", async () => {
    process.env.BRAIN_MODEL = "claude-opus-4-6";
    const json = await (await GET()).json();
    expect(json.model).toBe("claude-opus-4-6");
  });

  it("reports unconfigured with no key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const json = await (await GET()).json();
    expect(json.configured).toBe(false);
  });
});

describe("POST /api/brain — error semantics", () => {
  it("503 agent_unconfigured with no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await call({ messages: msgs });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("agent_unconfigured");
  });

  it("400 bad_request on invalid JSON", async () => {
    const res = await POST(new Request("http://x/api/brain", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("400 missing_messages when messages is missing or empty — rejected before any upstream call", async () => {
    const res1 = await call({});
    expect(res1.status).toBe(400);
    expect((await res1.json()).error).toBe("missing_messages");

    const res2 = await call({ messages: [] });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error).toBe("missing_messages");

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("404 agent_not_found for an unknown agentId", async () => {
    const res = await call({ agentId: "nope", messages: msgs });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("agent_not_found");
  });

  it("502 agent_failed, and logs the cause, when the registry fails for a reason OTHER than an unknown id", async () => {
    overridesState.reject = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call({ messages: msgs });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toBe("agent_failed");
      // The old code's bare `catch { return apiError("agent_not_found", 404) }`
      // relabeled every registry failure as 404 with an empty console — this
      // is the regression test for that.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("502 agent_failed, and never leaks the raw upstream message, when the model call throws", async () => {
    mockCreate.mockRejectedValue(new Error("some upstream secret detail"));
    const res = await call({ messages: msgs });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("agent_failed");
    expect(JSON.stringify(json)).not.toMatch(/upstream secret detail/);
  });
});

/* Task 15 widened strategist.md from [projects] to
   [crm, projects, drive, email, calendar, web]. With both integrations
   disconnected (the beforeEach default) that resolves to exactly this, in
   declaration order. Pinned as an array, not arrayContaining, so a group
   silently dropped from the frontmatter fails here too. */
const STRATEGIST_TOOLS_OFFLINE = [
  "query_leads", "query_tasks", "query_projects", "query_interactions",
  "search_pain_points", "get_pipeline_metrics",
  "list_projects", "get_project_context",
  "drive_search", "drive_read_file",
  "web_search",
];

describe("POST /api/brain — agent resolution", () => {
  it("defaults to strategist — which now reaches the whole business, not just projects", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(STRATEGIST_TOOLS_OFFLINE);
    // It declares email + calendar now, so both availability checks run —
    // and both resolve false here, which is exactly why a declaration-only
    // assertion is worthless: nothing inbox-shaped is in the list above.
    expect(mockEmailAvailable).toHaveBeenCalledTimes(1);
    expect(mockCalendarAvailable).toHaveBeenCalledTimes(1);
  });

  it("mode: 'brainstorm' resolves product-brainstorm (drive + web tools too)", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["list_projects", "get_project_context", "drive_search", "drive_read_file", "web_search"]),
    );
    // product-brainstorm declares neither group — the zero-DB-contact claim
    // still holds for the agents that don't ask for those integrations.
    expect(mockEmailAvailable).not.toHaveBeenCalled();
    expect(mockCalendarAvailable).not.toHaveBeenCalled();
  });

  it("an unrecognised mode falls back to strategist", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "not-a-real-mode", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(STRATEGIST_TOOLS_OFFLINE);
  });

  it("agentId wins over mode when both are present", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", agentId: "strategist", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(STRATEGIST_TOOLS_OFFLINE);
  });

  it("hands the strategist the inbox and calendar tools once they ARE connected — and still no mutation", async () => {
    mockEmailAvailable.mockResolvedValue(true);
    mockCalendarAvailable.mockResolvedValue(true);
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "query_leads", "query_emails", "query_calendar", "drive_search", "list_projects", "web_search",
    ]));
    // calendarEnabled is what makes create_calendar_event reachable — but only
    // through the `writes` group, which no Brain agent declares.
    for (const m of ["create_calendar_event", "create_task", "update_lead", "log_interaction"]) {
      expect(toolNames).not.toContain(m);
    }
  });

  it("each bench specialist reaches the CRM read tools", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    for (const agentId of ["deal-strategist", "discovery-coach", "pipeline-analyst"]) {
      mockCreate.mockClear();
      await call({ agentId, messages: msgs });
      const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
      expect(toolNames, agentId).toEqual(expect.arrayContaining([
        "query_leads", "query_interactions", "search_pain_points", "get_pipeline_metrics",
      ]));
    }
  });
});

/* The trap one level below "declared vs resolved": a tool can be in the list
   the model receives and still answer every call with an error. Brain sends no
   client snapshot, and the CRM resolvers read one — so before this route loads
   it server-side, every query_leads call came back
   {"error":"no snapshot available for this tool"} and the agent narrated
   around it. These tests execute a real tool call through the runtime.

   The SAME defect sat one layer over on Drive, and this section originally
   covered only the CRM half. Task 15 gave the strategist `drive` and told it
   to use drive_search, but the page forwarded a driveAccountId only on the
   brainstorm branch — so for the DEFAULT Brain agent every Drive call answered
   {"error":"Google Drive is not connected…"}, which the agent then relayed to
   the founder as a fact about their own integration. The Drive tests below
   close the class properly: both halves, resolved server-side. */
const toolUse = (name: string, input: Record<string, unknown> = {}) => ({
  content: [{ type: "tool_use", id: "tu_1", name, input }],
  stop_reason: "tool_use",
});

/** The tool_result the runtime fed back on the second model call. */
const resultText = (): string => {
  const followUp = mockCreate.mock.calls[1][0].messages.at(-1) as {
    content: { content: string }[];
  };
  return followUp.content[0].content;
};

describe("POST /api/brain — the CRM tools return data, not an error", () => {

  it("resolves query_leads against a server-loaded snapshot", async () => {
    mockCreate.mockResolvedValueOnce(toolUse("query_leads")).mockResolvedValueOnce(textResponse("done"));
    await call({ messages: msgs });
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    const out = resultText();
    expect(out).not.toContain("no snapshot");
    expect(out).toContain("Lanternpost Capital");
  });

  it("resolves get_pipeline_metrics too", async () => {
    mockCreate.mockResolvedValueOnce(toolUse("get_pipeline_metrics")).mockResolvedValueOnce(textResponse("done"));
    await call({ messages: msgs });
    expect(resultText()).not.toContain("no snapshot");
  });

  it("carries the ageing fields a pipeline question needs", async () => {
    mockCreate.mockResolvedValueOnce(toolUse("query_leads")).mockResolvedValueOnce(textResponse("done"));
    await call({ messages: msgs });
    const row = JSON.parse(resultText())[0];
    // compactLead carries these so "created in the last 30 days" and
    // "edited without a conversation" are computable, not guessed.
    expect(row.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(row.updatedAt).toBe("2026-08-01T00:00:00.000Z");
    // …and still compact.
    expect(row).not.toHaveProperty("notes");
  });

  /* The route narrows loadAll() through buildSnapshot. That narrowing is NOT
     observable from here — the snapshot never enters a model call, and every
     read tool projects its own output — so a "no secrets reached the model"
     assertion at this level passes with or without the narrowing and would be
     false assurance. The narrowing is pinned where it is real, on the function
     itself: src/lib/advisorClient.test.ts. The fixture above still carries the
     dropped collections so the route is exercised against the shape loadAll()
     actually returns. */

  // Same principle as resolveAvailability: an agent that never asks for the
  // CRM must not pay for a full DB read on every turn.
  it("never touches the DB for an agent that does not declare crm", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", messages: msgs });
    expect(mockLoadAll).not.toHaveBeenCalled();
  });

  it("502s with a logged cause when the snapshot load fails, rather than degrading silently", async () => {
    // The model call must succeed, so the 502 can only come from the snapshot.
    mockCreate.mockResolvedValue(textResponse("hi"));
    mockLoadAll.mockRejectedValue(new Error("db unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call({ messages: msgs });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("agent_failed");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("POST /api/brain — the Drive tools return data, not an error", () => {
  it("resolves drive_search for the DEFAULT agent, with no client-supplied account id", async () => {
    // The exact shape of the bug: strategist, no `context` at all.
    mockListAccounts.mockResolvedValue([driveAccount()]);
    mockSearchFiles.mockResolvedValue([{ id: "f1", name: "Lanternpost discovery.md" }]);
    mockCreate.mockResolvedValueOnce(toolUse("drive_search", { query: "lanternpost" }))
      .mockResolvedValueOnce(textResponse("done"));

    await call({ messages: msgs });

    const out = resultText();
    expect(out).not.toContain("not connected");
    expect(out).toContain("Lanternpost discovery.md");
    // Resolved from the connected account, not from anything the client sent.
    expect(mockSearchFiles).toHaveBeenCalledWith("gm_drive", "lanternpost");
  });

  it("resolves drive_read_file too", async () => {
    mockListAccounts.mockResolvedValue([driveAccount()]);
    mockReadFileContent.mockResolvedValue("the doc body");
    mockCreate.mockResolvedValueOnce(toolUse("drive_read_file", { fileId: "f1" }))
      .mockResolvedValueOnce(textResponse("done"));

    await call({ messages: msgs });

    expect(resultText()).toContain("the doc body");
    expect(mockReadFileContent).toHaveBeenCalledWith("gm_drive", "f1");
  });

  it("still resolves it for product-brainstorm, which used to be the only agent that worked", async () => {
    mockListAccounts.mockResolvedValue([driveAccount()]);
    mockSearchFiles.mockResolvedValue([{ id: "f1", name: "idea notes.md" }]);
    mockCreate.mockResolvedValueOnce(toolUse("drive_search")).mockResolvedValueOnce(textResponse("done"));

    await call({ mode: "brainstorm", messages: msgs });

    expect(resultText()).toContain("idea notes.md");
  });

  it("ignores a driveAccountId posted by the client — the browser cannot name the account", async () => {
    // Drive genuinely not connected. Pre-fix, this id went straight into
    // ctx.driveAccountId and out to the Google API.
    mockListAccounts.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce(toolUse("drive_search")).mockResolvedValueOnce(textResponse("done"));

    await call({ messages: msgs, context: { driveAccountId: "someone-elses-account" } });

    expect(mockSearchFiles).not.toHaveBeenCalled();
    expect(resultText()).toContain("not connected");
  });

  it("reports not-connected honestly when no account granted Drive scope", async () => {
    mockListAccounts.mockResolvedValue([gmailOnlyAccount()]);
    mockCreate.mockResolvedValueOnce(toolUse("drive_search")).mockResolvedValueOnce(textResponse("done"));

    await call({ messages: msgs });

    expect(mockSearchFiles).not.toHaveBeenCalled();
    expect(resultText()).toContain("not connected");
  });

  // Same principle as resolveAvailability and the snapshot: an agent that
  // never asks for Drive must not pay a DB read for it.
  it("never reads the accounts table for an agent that does not declare drive", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ agentId: "pipeline-analyst", messages: msgs });
    expect(mockListAccounts).not.toHaveBeenCalled();
  });

  it("reads it exactly once for an agent that does", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    expect(mockListAccounts).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/brain — BRAIN_MODEL override", () => {
  it("splices the env override onto the resolved spec's model", async () => {
    process.env.BRAIN_MODEL = "claude-opus-4-6";
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-opus-4-6");
  });

  it("falls back to the runtime default when BRAIN_MODEL is unset", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
  });
});

describe("POST /api/brain — attachments", () => {
  it("appends formatAttachmentsBlock's output to the rendered system prompt", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({
      mode: "brainstorm",
      messages: msgs,
      attachments: [{ name: "call.md", content: "notes from the call" }],
    });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).toContain("SESSION DOCUMENTS");
    expect(system).toContain("call.md");
    expect(system).toContain("notes from the call");
  });

  it("does not append an attachments block when there are none", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).not.toContain("SESSION DOCUMENTS");
  });
});

/* deal-strategist, discovery-coach and pipeline-analyst all interpolate
   {{services}}. roster.test.ts proves the token is SUBSTITUTABLE — it renders
   every persona against a fixture ctx that already supplies services — which
   is why it stayed green while the Brain page sent no services at all and
   every one of these three silently described the founder's business with a
   hardcoded default. These pin the value, not the substitutability. */
describe("POST /api/brain — {{services}} carries the founder's real Services setting", () => {
  const SERVICES = "reconciliation tooling for boutique asset managers";

  it.each(["deal-strategist", "discovery-coach", "pipeline-analyst"])(
    "%s renders the supplied services, not the route default",
    async (agentId) => {
      mockCreate.mockResolvedValue(textResponse("hi"));
      await call({ agentId, messages: msgs, context: { services: SERVICES } });
      const system = mockCreate.mock.calls[0][0].system as string;
      expect(system).toContain(SERVICES);
      expect(system).not.toContain("bespoke AI systems, workflow automation");
    },
  );

  it("falls back to the default only when the client sends none", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ agentId: "deal-strategist", messages: msgs });
    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("bespoke AI systems, workflow automation");
  });
});

describe("POST /api/brain — no unsubstituted placeholder ever reaches the model", () => {
  it("strategist: every {{token}} in the persona body is rendered before the system prompt is sent", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).not.toMatch(/\{\{/);
    expect(system).toContain("the founder"); // the default founderName substitution landed
  });

  it("product-brainstorm: same guarantee", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", messages: msgs, context: { founderName: "Emil" } });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).not.toMatch(/\{\{/);
    expect(system).toContain("Emil");
  });
});

describe("POST /api/brain — response shape", () => {
  it("returns content and stoppedBy", async () => {
    mockCreate.mockResolvedValue(textResponse("the answer"));
    const res = await call({ messages: msgs });
    const json = await res.json();
    expect(json.content).toBe("the answer");
    expect(json.stoppedBy).toBe("end");
  });

  it("substitutes a fallback message when the model returns no text", async () => {
    mockCreate.mockResolvedValue({ content: [], stop_reason: "end_turn" });
    const res = await call({ messages: msgs });
    const json = await res.json();
    expect(json.content).toBe("I couldn't produce a response — try rephrasing.");
  });
});

describe("resolveAvailability — only resolves the checks a spec's declared tools actually need", () => {
  const spec = (tools: AgentSpec["tools"]): Pick<AgentSpec, "tools"> => ({ tools });

  it("neither group declared: both false, neither DB-backed check is called", async () => {
    const result = await resolveAvailability(spec(["projects"]));
    expect(result).toEqual({ emailEnabled: false, calendarEnabled: false });
    expect(mockEmailAvailable).not.toHaveBeenCalled();
    expect(mockCalendarAvailable).not.toHaveBeenCalled();
  });

  it('"email" declared: only the email check runs', async () => {
    mockEmailAvailable.mockResolvedValue(true);
    const result = await resolveAvailability(spec(["email"]));
    expect(result).toEqual({ emailEnabled: true, calendarEnabled: false });
    expect(mockEmailAvailable).toHaveBeenCalledTimes(1);
    expect(mockCalendarAvailable).not.toHaveBeenCalled();
  });

  it('"calendar" declared: only the calendar check runs', async () => {
    mockCalendarAvailable.mockResolvedValue(true);
    const result = await resolveAvailability(spec(["calendar"]));
    expect(result).toEqual({ emailEnabled: false, calendarEnabled: true });
    expect(mockCalendarAvailable).toHaveBeenCalledTimes(1);
    expect(mockEmailAvailable).not.toHaveBeenCalled();
  });

  it('"writes" declared: counts as wanting calendar too (create_calendar_event rides with the other mutations)', async () => {
    mockCalendarAvailable.mockResolvedValue(true);
    const result = await resolveAvailability(spec(["writes"]));
    expect(result.calendarEnabled).toBe(true);
    expect(mockCalendarAvailable).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/brain — a spec that declares 'email' actually receives the email tools", () => {
  it("wires ctx.emailEnabled through to the resolved tool list end to end", async () => {
    registryOverride.spec = {
      id: "email-test-agent", name: "T", description: "D", color: "#fff", emoji: "A", vibe: "V",
      surface: "brain", tools: ["email"], body: "SYSTEM {{today}}",
    };
    mockEmailAvailable.mockResolvedValue(true);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({ agentId: "email-test-agent", messages: msgs });

    expect(mockEmailAvailable).toHaveBeenCalledTimes(1);
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("query_emails");
  });

  it("the same spec receives nothing when the inbox isn't actually connected", async () => {
    registryOverride.spec = {
      id: "email-test-agent", name: "T", description: "D", color: "#fff", emoji: "A", vibe: "V",
      surface: "brain", tools: ["email"], body: "SYSTEM {{today}}",
    };
    mockEmailAvailable.mockResolvedValue(false);
    mockCreate.mockResolvedValue(textResponse("hi"));

    await call({ agentId: "email-test-agent", messages: msgs });

    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).not.toContain("query_emails");
  });
});

describe("AgentNotFound export", () => {
  it("is a real Error subclass, as the route's catch relies on", () => {
    expect(new AgentNotFound("x")).toBeInstanceOf(Error);
  });
});
