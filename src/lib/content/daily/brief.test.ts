import { describe, it, expect, vi } from "vitest";
import { buildBriefPrompt, chooseBriefs, briefSchema } from "./brief";
import { buildMemory } from "./rotation";
import { PILLARS, FORMATS, type ContentPost, type MaterialItem, type PostBrief } from "./types";

const ledger: MaterialItem[] = [
  { collection: "painPoints", id: "pp1", date: "2026-08-03",
    text: "Reconciliation takes 14 hours every month end.",
    anchors: ["14"], pillarHints: ["client-pain"], score: 50 },
  { collection: "scorecards", id: "sc1", date: "2026-08-02",
    text: "Shipped the ingest job. Broke twice.",
    anchors: [], pillarHints: ["build-log", "lesson"], score: 30 },
];

function post(over: Partial<ContentPost>): ContentPost {
  return {
    id: "x", date: "2026-08-03", slot: 1, pillar: "proof", format: "numbers",
    sourceRefs: [], claim: "", body: "", openingLine: "An opener.", checks: [],
    revisions: 0, status: "posted", killReason: null, editedBody: null,
    createdAt: "", updatedAt: "", ...over,
  };
}

/** The 2026-08-12 production history: every pillar and format inside window. */
const EXHAUSTED: ContentPost[] = [
  post({ id: "a", date: "2026-08-11", pillar: "proof", format: "numbers" }),
  post({ id: "b", date: "2026-08-11", pillar: "build-log", format: "short-punch" }),
  post({ id: "c", date: "2026-08-10", pillar: "client-pain", format: "claim-defence" }),
  post({ id: "d", date: "2026-08-10", pillar: "contrarian", format: "one-idea" }),
  post({ id: "e", date: "2026-08-10", pillar: "teardown", format: "before-after" }),
  post({ id: "f", date: "2026-08-10", pillar: "lesson", format: "scene" }),
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
    // Assert the BLOCKED LINES, not the bare words. "proof", "numbers" and
    // "must differ" all appear in the static pillar/format catalogues and the
    // fixed constraints line, so matching those alone passes against an empty
    // memory — it proves nothing about whether history reached the prompt.
    expect(p).toContain("blocked: proof (used 2026-08-03)");
    expect(p).toContain("blocked: numbers (used 2026-08-03)");
    expect(p).toMatch(/must differ in BOTH pillar and format/i);
  });

  it("says explicitly when nothing is blocked, rather than omitting the line", () => {
    // The counterpart to the test above: with clean history the blocked lines
    // must still be present and read "none", so the two tests together pin the
    // line's presence AND its content.
    const p = buildBriefPrompt(base);
    expect(p).toContain("blocked: none");
    expect(p).not.toContain("(used ");
  });

  it("carries the source records blocked by the 21-day window", () => {
    const memory = buildMemory(
      [{ id: "x", date: "2026-08-01", slot: 1, pillar: "lesson", format: "scene",
         sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
         claim: "", body: "", openingLine: "An opener.", checks: [],
         revisions: 0, status: "posted", killReason: null, editedBody: null,
         createdAt: "", updatedAt: "" }],
      "2026-08-04",
    );
    expect(buildBriefPrompt({ ...base, memory })).toContain("painPoints:pp1");
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

  it("catalogues only the pillars and formats still choosable today", () => {
    // The catalogue used to list all six regardless, leaving the model to
    // subtract the blocked line from it. On 2026-08-12 it did not subtract.
    const memory = buildMemory(
      [post({ date: "2026-08-03", pillar: "proof", format: "numbers" })], "2026-08-04",
    );
    const p = buildBriefPrompt({ ...base, memory });
    expect(p).not.toContain(`- proof: `);
    expect(p).not.toContain(`- numbers: `);
    expect(p).toContain(`- lesson: `);
  });

  it("still offers two pillars and two formats when every window is exhausted", () => {
    const p = buildBriefPrompt({ ...base, memory: buildMemory(EXHAUSTED, "2026-08-12") });
    const listed = (all: readonly string[]) => all.filter((x) => p.includes(`- ${x}: `)).length;
    expect(listed(PILLARS)).toBeGreaterThanOrEqual(2);
    expect(listed(FORMATS)).toBeGreaterThanOrEqual(2);
  });
});

describe("briefSchema", () => {
  const clean = buildMemory([], "2026-08-04");

  function enums(memory: Parameters<typeof briefSchema>[0]) {
    const props = briefSchema(memory).input_schema.properties as Record<string, unknown>;
    const items = (props.briefs as {
      items: { required: string[]; properties: Record<string, { enum: string[] }> };
    }).items;
    return items;
  }

  it("requires two briefs with the load-bearing fields", () => {
    expect(enums(clean).required).toEqual(
      expect.arrayContaining(["slot", "pillar", "format", "claim", "anchor", "sourceRefs"]),
    );
  });

  it("offers every pillar and format when nothing is blocked", () => {
    expect(enums(clean).properties.pillar.enum).toEqual([...PILLARS]);
    expect(enums(clean).properties.format.enum).toEqual([...FORMATS]);
  });

  it("drops blocked options from the enum so a violation cannot be expressed", () => {
    // The prompt asked the model not to pick a blocked pillar and on
    // 2026-08-12 it picked one anyway, twice. A narrowed enum is not a
    // request — the tool call cannot carry the value at all.
    const memory = buildMemory(
      [post({ date: "2026-08-03", pillar: "proof", format: "numbers" })], "2026-08-04",
    );
    expect(enums(memory).properties.pillar.enum).not.toContain("proof");
    expect(enums(memory).properties.format.enum).not.toContain("numbers");
    expect(enums(memory).properties.pillar.enum).toContain("lesson");
  });

  it("never narrows below the two distinct choices the day needs", () => {
    const memory = buildMemory(EXHAUSTED, "2026-08-12");
    expect(enums(memory).properties.pillar.enum.length).toBeGreaterThanOrEqual(2);
    expect(enums(memory).properties.format.enum.length).toBeGreaterThanOrEqual(2);
  });
});

/** A client whose every response is a well-formed submit_briefs tool call. */
function stubClient(responses: PostBrief[][]) {
  return rawClient(
    responses.map((briefs, n) => [
      { type: "tool_use", id: `t${n}`, name: "submit_briefs", input: { briefs } },
    ]),
  );
}

/** A client returning arbitrary content blocks, for malformed-output cases. */
function rawClient(responses: unknown[][]) {
  let call = 0;
  return {
    messages: {
      create: vi.fn(async () => ({
        content: responses[call++],
        stop_reason: "tool_use",
      })),
    },
  } as never;
}

/** The recorded arguments of every messages.create call on a stub client. */
function calls(client: unknown): unknown[][] {
  return (client as { messages: { create: { mock: { calls: unknown[][] } } } })
    .messages.create.mock.calls;
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

    const second = calls(client)[1][0] as {
      messages: { role: string; content: unknown }[];
    };
    // Assert the RETRY TURN specifically. Searching the whole messages array
    // for /must differ/ matches the original prompt's static constraints line,
    // so it passes even when no feedback is sent at all.
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2].role).toBe("user");
    // The feedback rides inside the tool_result block, which is the only shape
    // the API accepts after a tool_use — stringify rather than String(), which
    // flattens the block array to "[object Object]" and would assert nothing.
    expect(JSON.stringify(second.messages[2].content)).toContain(
      'same day: both slots chose pillar \\"client-pain\\"',
    );
  });

  it("replays the rejected briefs back as an assistant turn", async () => {
    // Without this turn the model is asked to "choose again" with no record of
    // what it actually chose — the feedback names violations of briefs it can
    // no longer see.
    const clash = [valid[0], { ...valid[1], pillar: "client-pain" as const }];
    const client = stubClient([clash, valid]);
    await chooseBriefs(client, base, base.memory);

    const second = calls(client)[1][0] as {
      messages: { role: string; content: unknown }[];
    };
    expect(second.messages[1].role).toBe("assistant");
    expect(JSON.stringify(second.messages[1].content)).toContain("submit_briefs");
  });

  it("answers every replayed tool_use with a matching tool_result block", async () => {
    // The API rejects the whole request with a 400 when an assistant turn
    // carrying a tool_use is followed by a user turn that is not a tool_result
    // for it: "`tool_use` ids were found without `tool_result` blocks
    // immediately after". That 400 surfaced as a 502 on every regeneration,
    // because regenerating a day that already has posts fills the rotation
    // memory and makes a violation — and therefore this retry turn — near
    // certain. The stub client cannot enforce the protocol, so it is asserted
    // here: the retry turn MUST open with a tool_result whose tool_use_id is
    // the id of the tool_use being answered.
    const clash = [valid[0], { ...valid[1], pillar: "client-pain" as const }];
    const client = stubClient([clash, valid]);
    await chooseBriefs(client, base, base.memory);

    const second = calls(client)[1][0] as {
      messages: { role: string; content: unknown }[];
    };
    const assistant = second.messages[1].content as { type: string; id: string }[];
    const toolUseIds = assistant.filter((b) => b.type === "tool_use").map((b) => b.id);
    expect(toolUseIds).toHaveLength(1);

    const reply = second.messages[2];
    expect(reply.role).toBe("user");
    expect(Array.isArray(reply.content)).toBe(true);

    const blocks = reply.content as { type: string; tool_use_id?: string }[];
    // Every tool_use answered, and the tool_results come first in the turn.
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id))
      .toEqual(toolUseIds);
  });

  it("forces the model through the submit_briefs tool", async () => {
    const client = stubClient([valid]);
    await chooseBriefs(client, base, base.memory);
    const first = calls(client)[0][0] as {
      tool_choice?: { type: string; name: string };
      tools: { name: string }[];
    };
    expect(first.tool_choice).toEqual({ type: "tool", name: "submit_briefs" });
    expect(first.tools.map((t) => t.name)).toContain("submit_briefs");
  });

  it("succeeds on the exhausted history that produced the 502", async () => {
    // The closing of the loop: anything the narrowed schema PERMITS must be
    // something validateBriefs ACCEPTS. A model that simply obeys the enum is
    // simulated by taking the first two options it offers. Before the fix this
    // history left zero legal brief pairs and chooseBriefs threw brief_invalid
    // on both attempts, which the route turned into upstream_failed / 502.
    const memory = buildMemory(EXHAUSTED, "2026-08-12");
    const props = briefSchema(memory).input_schema.properties as Record<string, unknown>;
    const items = (props.briefs as {
      items: { properties: Record<string, { enum: string[] }> };
    }).items;
    const okPillars = items.properties.pillar.enum;
    const okFormats = items.properties.format.enum;

    const obedient: PostBrief[] = [
      { ...valid[0], pillar: okPillars[0] as never, format: okFormats[0] as never },
      { ...valid[1], pillar: okPillars[1] as never, format: okFormats[1] as never },
    ];

    const out = await chooseBriefs(
      stubClient([obedient]),
      { ...base, memory, today: "2026-08-12" },
      memory,
    );
    expect(out).toHaveLength(2);
  });

  it("throws when the retry also violates the guardrails", async () => {
    const clash = [valid[0], { ...valid[1], pillar: "client-pain" as const }];
    await expect(chooseBriefs(stubClient([clash, clash]), base, base.memory))
      .rejects.toThrow(/brief_invalid/);
  });

  describe("malformed model output", () => {
    it("throws rather than returning nothing when the model calls no tool", async () => {
      // The dangerous shape: returning [] here would make validateBriefs pass
      // vacuously (no briefs, no violations) and the run would proceed with an
      // empty day instead of failing loudly.
      await expect(
        chooseBriefs(rawClient([[{ type: "text", text: "I'd rather not." }]]), base, base.memory),
      ).rejects.toThrow(/brief_invalid/);
    });

    it("throws when the tool_use block is for a different tool", async () => {
      await expect(
        chooseBriefs(
          rawClient([[{ type: "tool_use", id: "t0", name: "something_else", input: { briefs: valid } }]]),
          base,
          base.memory,
        ),
      ).rejects.toThrow(/brief_invalid/);
    });

    it("throws when the model submits one brief instead of two", async () => {
      await expect(
        chooseBriefs(
          rawClient([[{ type: "tool_use", id: "t0", name: "submit_briefs", input: { briefs: [valid[0]] } }]]),
          base,
          base.memory,
        ),
      ).rejects.toThrow(/brief_invalid/);
    });

    it("throws when the model submits three briefs", async () => {
      await expect(
        chooseBriefs(
          rawClient([[{
            type: "tool_use", id: "t0", name: "submit_briefs",
            input: { briefs: [valid[0], valid[1], valid[0]] },
          }]]),
          base,
          base.memory,
        ),
      ).rejects.toThrow(/brief_invalid/);
    });
  });
});
