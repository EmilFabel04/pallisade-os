import { describe, it, expect } from "vitest";
import { isDismissed, visibleFollowUps } from "@/lib/gmail/followUpFilter";
import { heuristicJudgement } from "@/lib/gmail/sentJudge";
import type { FollowUpState } from "@/lib/types";
import type { FollowUp } from "@/lib/gmail/sentScan";

const TODAY = "2026-09-23";

const state = (overrides: Partial<FollowUpState>): FollowUpState => ({
  id: "s1",
  email: "jane@acme.co",
  status: "handled",
  until: null,
  createdAt: TODAY,
  updatedAt: TODAY,
  ...overrides,
});

const followUp = (overrides: Partial<FollowUp> = {}): FollowUp => ({
  email: "jane@acme.co",
  name: "Jane Roe",
  company: "Acme",
  lastSent: "2026-09-10T00:00:00.000Z",
  daysSince: 13,
  subject: "Quick question",
  threadId: "t1",
  bucket: "awaiting_you",
  judgement: heuristicJudgement({ included: true, reason: "subject" }),
  agrees: null,
  ...overrides,
});

describe("isDismissed", () => {
  it("hides a recipient marked handled", () => {
    expect(isDismissed(state({ status: "handled", until: null }), TODAY)).toBe(true);
  });

  it("hides a recipient marked handled even if a stray until is in the past", () => {
    expect(isDismissed(state({ status: "handled", until: "2020-01-01" }), TODAY)).toBe(true);
  });

  it("hides a recipient snoozed until a future date", () => {
    expect(isDismissed(state({ status: "snoozed", until: "2026-09-30" }), TODAY)).toBe(true);
  });

  it("shows a recipient once their snooze date is in the past", () => {
    expect(isDismissed(state({ status: "snoozed", until: "2026-09-01" }), TODAY)).toBe(false);
  });

  it("shows a recipient on the day their snooze expires (until === today is not still hidden)", () => {
    expect(isDismissed(state({ status: "snoozed", until: TODAY }), TODAY)).toBe(false);
  });

  it("shows a recipient with no stored state", () => {
    expect(isDismissed(undefined, TODAY)).toBe(false);
  });
});

describe("visibleFollowUps", () => {
  it("drops handled and actively-snoozed recipients, keeps the rest", () => {
    const followUps = [
      followUp({ email: "jane@acme.co" }),
      followUp({ email: "bob@example.com" }),
      followUp({ email: "sue@example.com" }),
    ];
    const states: FollowUpState[] = [
      state({ email: "jane@acme.co", status: "handled", until: null }),
      state({ email: "bob@example.com", status: "snoozed", until: "2026-09-30" }),
    ];

    expect(visibleFollowUps(followUps, states, TODAY).map((f) => f.email)).toEqual([
      "sue@example.com",
    ]);
  });

  it("reveals a recipient again once their snooze expires", () => {
    const followUps = [followUp({ email: "bob@example.com" })];
    const states: FollowUpState[] = [
      state({ email: "bob@example.com", status: "snoozed", until: "2026-09-01" }),
    ];

    expect(visibleFollowUps(followUps, states, TODAY).map((f) => f.email)).toEqual([
      "bob@example.com",
    ]);
  });
});
