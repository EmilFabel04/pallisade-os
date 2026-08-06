import { describe, it, expect } from "vitest";
import { checkDisclosure } from "./disclosure";
import { buildVocabulary } from "./redact";
import type { DataShape } from "@/lib/types";

const vocab = buildVocabulary({
  leads: [{ id: "l1", company: "Kestrelmoor Capital", contactName: "Sarah Whitfield" }],
  interactions: [{ id: "i1", company: "Lanternpost Partners", contact: "James Okoro" }],
} as unknown as DataShape);

const run = (body: string) => checkDisclosure(body, vocab);

/** The shape the engine is meant to produce: a client's world, unattributed,
 *  anchored on a real figure, told with authority. */
const CLEAN =
  "Reconciliation took them 14 hours every month end.\n" +
  "For numbers that already existed in two systems.\n" +
  "We wired the two together and it runs in 20 minutes now, unattended.";

describe("clean posts", () => {
  it("passes a post that is specific about a client without naming them", () => {
    expect(run(CLEAN).passed).toBe(true);
  });

  it("keeps a client's operational figure, which is the post's anchor", () => {
    // The Q2 decision: numbers measuring HIS business are blocked, a client's
    // own operational figure is not. Banning every digit would strip the
    // anchor checkSpecificity requires and fail almost every post.
    expect(run("A finance team loses 14 hours a month to reconciliation.").passed).toBe(true);
  });

  it("allows a resolved lesson told as expertise", () => {
    expect(
      run("Ingest jobs fail twice on retry when the queue is not idempotent. Here is the fix.")
        .passed,
    ).toBe(true);
  });

  it("does not fire on ordinary words that merely resemble the banned ones", () => {
    expect(run("The revenue model of the average finance team is not the problem.").passed)
      .toBe(true);
  });
});

describe("identity", () => {
  it("fails a post naming a company from his own records", () => {
    // The hole this check exists to close: a REAL name traces perfectly
    // against the source record, so checkSpecificity passes it.
    const c = run("Kestrelmoor Capital still reconciles by hand.");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/Kestrelmoor Capital/);
  });

  it("fails a post naming a contact", () => {
    expect(run("Sarah Whitfield told me it takes 14 hours.").passed).toBe(false);
  });

  it("fails on a bare first name", () => {
    expect(run("Sarah told me it takes 14 hours.").passed).toBe(false);
  });

  it("matches regardless of case", () => {
    expect(run("kestrelmoor capital still reconciles by hand.").passed).toBe(false);
  });

  it("names every leaked identity in the detail, so revise can act on it", () => {
    const c = run("Lanternpost Partners and James Okoro both said the same thing.");
    expect(c.detail).toMatch(/Lanternpost Partners/);
    expect(c.detail).toMatch(/James Okoro/);
  });
});

describe("business metrics and stage", () => {
  const blocked = [
    "I am still pre-revenue and it shows.",
    "My first client signed last week.",
    "We have no paying customers yet.",
    "MRR is finally moving.",
    "My pipeline is thin this month.",
    "40 dials today and 2 replies.",
    "I booked 3 meetings this week.",
    "Still building, still nothing to show.",
    "I have not closed anything this quarter.",
    "Bootstrapping this with no runway left.",
  ];

  for (const body of blocked) {
    it(`fails: ${body}`, () => {
      expect(run(body).passed).toBe(false);
    });
  }

  it("explains which signal fired rather than saying the post is wrong", () => {
    const c = run("I am still pre-revenue and it shows.");
    expect(c.detail).toMatch(/pre-revenue/i);
    expect(c.detail.length).toBeGreaterThan(20);
  });
});

describe("unresolved struggle", () => {
  const blocked = [
    "I'm stuck and I don't know why this keeps happening.",
    "Honestly I have no idea what I am doing here.",
    "I can't figure out why it broke again.",
    "I am struggling to keep up with all of it.",
    "I'm exhausted and falling behind.",
    "Not sure if this is even going to work.",
  ];

  for (const body of blocked) {
    it(`fails: ${body}`, () => {
      expect(run(body).passed).toBe(false);
    });
  }

  it("allows the same difficulty once it is resolved", () => {
    expect(
      run("It broke twice on retry. The queue was not idempotent. That is now fixed.").passed,
    ).toBe(true);
  });
});

describe("check contract", () => {
  it("uses the shared rule name so the revise loop can route it", () => {
    expect(run(CLEAN).rule).toBe("disclosure");
  });

  it("reports something specific on a pass, like every other check", () => {
    expect(run(CLEAN).detail.length).toBeGreaterThan(0);
  });

  it("reports every category that fired, not just the first", () => {
    const c = run("Kestrelmoor Capital signed as my first client and I'm still stuck.");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/Kestrelmoor Capital/);
    expect(c.detail).toMatch(/first client/i);
  });
});
