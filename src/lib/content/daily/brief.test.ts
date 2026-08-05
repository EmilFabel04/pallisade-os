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
    expect(String(second.messages[2].content)).toContain(
      'same day: both slots chose pillar "client-pain"',
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
